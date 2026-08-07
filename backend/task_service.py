"""Логика заданий: периоды, прогресс, награды."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import models
import schemas

_TASK_TZ = ZoneInfo("Europe/Moscow")
PeriodType = Literal["daily", "weekly", "monthly"]


def task_calendar_today() -> date:
    """Текущая календарная дата в Europe/Moscow."""
    return datetime.now(_TASK_TZ).date()


def get_period_start(period_type: PeriodType, *, today: date | None = None) -> date:
    """Возвращает начало текущего периода для типа задания."""
    current = today or task_calendar_today()
    if period_type == "daily":
        return current
    if period_type == "weekly":
        return current - timedelta(days=current.weekday())
    return current - timedelta(days=29)


def is_period_expired(period_type: PeriodType, period_start: date, *, today: date | None = None) -> bool:
    """Проверяет, истёк ли период прогресса."""
    current = today or task_calendar_today()
    if period_type == "daily":
        return period_start != current
    if period_type == "weekly":
        return get_period_start("weekly", today=current) != period_start
    return current - period_start >= timedelta(days=30)


async def get_or_create_quota_settings(db: AsyncSession) -> models.TaskQuotaSettings:
    """Возвращает настройки квот заданий (singleton)."""
    result = await db.execute(select(models.TaskQuotaSettings).limit(1))
    settings = result.scalars().first()
    if settings:
        return settings
    settings = models.TaskQuotaSettings()
    db.add(settings)
    await db.commit()
    await db.refresh(settings)
    return settings


async def update_quota_settings(
    db: AsyncSession,
    payload: schemas.TaskQuotaSettingsUpdate,
) -> models.TaskQuotaSettings:
    """Обновляет квоты заданий."""
    settings = await get_or_create_quota_settings(db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(settings, key, value)
    await db.commit()
    await db.refresh(settings)
    return settings


async def get_all_tasks(db: AsyncSession) -> list[models.Task]:
    """Все задания для админки."""
    result = await db.execute(
        select(models.Task).order_by(
            models.Task.period_type.asc(),
            models.Task.sort_order.asc(),
            models.Task.id.asc(),
        )
    )
    return result.scalars().all()


async def get_active_tasks(db: AsyncSession) -> list[models.Task]:
    """Активные задания для пользователя."""
    result = await db.execute(
        select(models.Task)
        .where(models.Task.is_active == True)
        .order_by(
            models.Task.period_type.asc(),
            models.Task.sort_order.asc(),
            models.Task.id.asc(),
        )
    )
    return result.scalars().all()


async def count_active_tasks_by_period(db: AsyncSession, period_type: PeriodType) -> int:
    """Считает активные задания указанного периода."""
    result = await db.execute(
        select(func.count())
        .select_from(models.Task)
        .where(models.Task.is_active == True, models.Task.period_type == period_type)
    )
    return int(result.scalar_one())


async def _ensure_quota_available(
    db: AsyncSession,
    period_type: PeriodType,
    *,
    exclude_task_id: int | None = None,
) -> None:
    """Проверяет, что не превышена квота заданий для периода."""
    settings = await get_or_create_quota_settings(db)
    limits = {
        "daily": settings.max_daily_tasks,
        "weekly": settings.max_weekly_tasks,
        "monthly": settings.max_monthly_tasks,
    }
    limit = limits[period_type]
    query = select(func.count()).select_from(models.Task).where(
        models.Task.is_active == True,
        models.Task.period_type == period_type,
    )
    if exclude_task_id is not None:
        query = query.where(models.Task.id != exclude_task_id)
    result = await db.execute(query)
    active_count = int(result.scalar_one())
    if active_count >= limit:
        raise ValueError(f"Достигнут лимит заданий для периода «{period_type}» ({limit})")


async def create_task(db: AsyncSession, payload: schemas.TaskCreate) -> models.Task:
    """Создаёт кастомное задание."""
    await _ensure_quota_available(db, payload.period_type)
    db_task = models.Task(**payload.model_dump(), is_system=False, system_key=None)
    db.add(db_task)
    await db.commit()
    await db.refresh(db_task)
    return db_task


async def update_task(
    db: AsyncSession,
    task_id: int,
    payload: schemas.TaskUpdate,
) -> models.Task | None:
    """Обновляет задание."""
    result = await db.execute(select(models.Task).where(models.Task.id == task_id))
    db_task = result.scalars().first()
    if not db_task:
        return None

    update_data = payload.model_dump(exclude_unset=True)
    new_period = update_data.get("period_type")
    if new_period and new_period != db_task.period_type and not db_task.is_system:
        await _ensure_quota_available(db, new_period, exclude_task_id=db_task.id)

    if db_task.is_system:
        for field in ("title", "period_type", "is_active"):
            update_data.pop(field, None)

    for key, value in update_data.items():
        setattr(db_task, key, value)

    await db.commit()
    await db.refresh(db_task)
    return db_task


async def delete_task(db: AsyncSession, task_id: int) -> bool:
    """Удаляет кастомное задание."""
    result = await db.execute(select(models.Task).where(models.Task.id == task_id))
    db_task = result.scalars().first()
    if not db_task or db_task.is_system:
        return False
    await db.delete(db_task)
    await db.commit()
    return True


async def _get_progress_row(
    db: AsyncSession,
    user_id: int,
    task: models.Task,
) -> models.UserTaskProgress:
    """Возвращает или создаёт строку прогресса для текущего периода."""
    period_start = get_period_start(task.period_type)
    result = await db.execute(
        select(models.UserTaskProgress).where(
            models.UserTaskProgress.user_id == user_id,
            models.UserTaskProgress.task_id == task.id,
            models.UserTaskProgress.period_start == period_start,
        )
    )
    progress = result.scalars().first()
    if progress:
        return progress

    progress = models.UserTaskProgress(
        user_id=user_id,
        task_id=task.id,
        period_start=period_start,
        current_count=0,
    )
    db.add(progress)
    await db.flush()
    return progress


def _build_progress_response(
    task: models.Task,
    progress: models.UserTaskProgress,
) -> schemas.UserTaskProgressResponse:
    """Собирает DTO прогресса задания."""
    completed = progress.completed_at is not None
    percent = 100 if completed else min(
        100,
        int(round(progress.current_count / max(task.target_count, 1) * 100)),
    )
    return schemas.UserTaskProgressResponse(
        current_count=progress.current_count,
        target_count=task.target_count,
        completed=completed,
        completed_at=progress.completed_at,
        progress_percent=percent,
    )


def task_to_response(task: models.Task) -> schemas.TaskResponse:
    """Преобразует модель задания в ответ API."""
    return schemas.TaskResponse(
        id=task.id,
        title=task.title,
        description=task.description,
        period_type=task.period_type,
        target_count=task.target_count,
        reward_likes=task.reward_likes,
        is_active=task.is_active,
        sort_order=task.sort_order,
        is_system=task.is_system,
        system_key=task.system_key,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


async def get_user_tasks(db: AsyncSession, user_id: int) -> list[schemas.UserTaskResponse]:
    """Каталог заданий пользователя с прогрессом."""
    tasks = await get_active_tasks(db)
    responses: list[schemas.UserTaskResponse] = []
    for task in tasks:
        progress = await _get_progress_row(db, user_id, task)
        base = task_to_response(task)
        responses.append(
            schemas.UserTaskResponse(
                **base.model_dump(),
                progress=_build_progress_response(task, progress),
            )
        )
    await db.commit()
    return responses


async def _grant_task_reward(
    db: AsyncSession,
    user: models.User,
    task: models.Task,
    progress: models.UserTaskProgress,
) -> None:
    """Начисляет награду за выполненное задание."""
    if progress.reward_granted or task.reward_likes <= 0:
        progress.reward_granted = True
        return
    user.balance += task.reward_likes
    progress.reward_granted = True


async def increment_system_task_progress(
    db: AsyncSession,
    user_id: int,
    system_key: str,
    amount: int = 1,
) -> None:
    """Увеличивает прогресс системного задания и выдаёт награду при выполнении."""
    if amount <= 0:
        return

    result = await db.execute(
        select(models.Task).where(
            models.Task.is_active == True,
            models.Task.system_key == system_key,
        )
    )
    task = result.scalars().first()
    if not task:
        return

    user = await db.get(models.User, user_id)
    if not user:
        return

    progress = await _get_progress_row(db, user_id, task)
    if progress.completed_at is not None:
        return

    progress.current_count = min(task.target_count, progress.current_count + amount)
    if progress.current_count >= task.target_count:
        progress.completed_at = datetime.utcnow()
        await _grant_task_reward(db, user, task, progress)
        import task_notification_service
        await task_notification_service.notify_task_completed(db, user_id, task)
        return

    await db.commit()
