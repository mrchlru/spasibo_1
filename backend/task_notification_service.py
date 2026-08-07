"""Push/in-app уведомления по заданиям."""

from __future__ import annotations

import logging
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import crud
import models
import task_service

logger = logging.getLogger(__name__)

TASKS_PROFILE_URL = "/?panel=profile&section=tasks"
REMINDER_PROGRESS_RATIO = 0.5
REMINDER_ALMOST_DONE_REMAINING = 1


async def _was_notification_sent(
    db: AsyncSession,
    *,
    user_id: int,
    kind: str,
    sent_on: date,
    task_id: int | None,
) -> bool:
    """Проверяет, отправлялось ли уведомление в этот день."""
    log_task_id = task_id if task_id is not None else 0
    result = await db.execute(
        select(models.TaskNotificationLog.id).where(
            models.TaskNotificationLog.user_id == user_id,
            models.TaskNotificationLog.kind == kind,
            models.TaskNotificationLog.sent_on == sent_on,
            models.TaskNotificationLog.task_id == log_task_id,
        )
    )
    return result.scalars().first() is not None


async def _mark_notification_sent(
    db: AsyncSession,
    *,
    user_id: int,
    kind: str,
    sent_on: date,
    task_id: int | None,
) -> None:
    """Фиксирует отправку уведомления."""
    db.add(
        models.TaskNotificationLog(
            user_id=user_id,
            kind=kind,
            task_id=task_id if task_id is not None else 0,
            sent_on=sent_on,
        )
    )


async def _notify_task(
    db: AsyncSession,
    *,
    user_id: int,
    kind: str,
    title: str,
    message: str,
    task_id: int | None,
    sent_on: date,
) -> bool:
    """Отправляет уведомление о задании, если ещё не отправляли сегодня."""
    if await _was_notification_sent(db, user_id=user_id, kind=kind, sent_on=sent_on, task_id=task_id):
        return False
    await crud._create_notification(
        db,
        user_id,
        "task",
        title,
        message,
        click_url=TASKS_PROFILE_URL,
    )
    await _mark_notification_sent(db, user_id=user_id, kind=kind, sent_on=sent_on, task_id=task_id)
    return True


async def notify_task_completed(
    db: AsyncSession,
    user_id: int,
    task: models.Task,
) -> None:
    """Уведомляет пользователя о выполнении задания."""
    today = task_service.task_calendar_today()
    reward_part = f" +{task.reward_likes} лайк(ов)" if task.reward_likes > 0 else ""
    await _notify_task(
        db,
        user_id=user_id,
        kind="task_completed",
        title="Задание выполнено",
        message=f"«{task.title}» выполнено{reward_part}.",
        task_id=task.id,
        sent_on=today,
    )
    await db.commit()


def _period_ends_soon(task: models.Task, *, today: date) -> bool:
    """True, если период задания скоро закончится."""
    period_start = task_service.get_period_start(task.period_type, today=today)
    if task.period_type == "daily":
        return True
    if task.period_type == "weekly":
        days_left = 6 - today.weekday()
        return days_left <= 1
    days_in_period = (today - period_start).days
    return days_in_period >= 27


def _is_almost_done(task: models.Task, progress: models.UserTaskProgress) -> bool:
    """True, если до выполнения осталось совсем немного."""
    if progress.current_count <= 0:
        return False
    remaining = task.target_count - progress.current_count
    if remaining <= REMINDER_ALMOST_DONE_REMAINING:
        return True
    return progress.current_count / max(task.target_count, 1) >= REMINDER_PROGRESS_RATIO


async def _iter_active_users(db: AsyncSession):
    """Активные пользователи (не deleted/rejected)."""
    result = await db.execute(
        select(models.User).where(
            models.User.status.not_in(["deleted", "rejected"]),
        )
    )
    return result.scalars().all()


async def send_morning_task_refresh_notifications(db: AsyncSession) -> int:
    """09:00 МСК — «Задания обновлены, зайдите посмотреть»."""
    today = task_service.task_calendar_today()
    tasks = await task_service.get_active_tasks(db)
    if not tasks:
        return 0

    sent_count = 0
    for user in await _iter_active_users(db):
        if await _notify_task(
            db,
            user_id=user.id,
            kind="daily_refresh",
            title="Задания обновлены",
            message="Новый день — проверьте задания в профиле и заберите награды.",
            task_id=None,
            sent_on=today,
        ):
            sent_count += 1
    await db.commit()
    logger.info("Утренние уведомления о заданиях: %s пользователей", sent_count)
    return sent_count


async def send_evening_task_reminder_notifications(db: AsyncSession) -> int:
    """Вечерние напоминания: почти выполнено или период скоро закончится."""
    today = task_service.task_calendar_today()
    tasks = await task_service.get_active_tasks(db)
    if not tasks:
        return 0

    sent_count = 0
    for user in await _iter_active_users(db):
        for task in tasks:
            progress = await task_service._get_progress_row(db, user.id, task)
            if progress.completed_at is not None:
                continue

            if _is_almost_done(task, progress):
                if await _notify_task(
                    db,
                    user_id=user.id,
                    kind="reminder_almost_done",
                    title="Почти готово",
                    message=(
                        f"«{task.title}»: осталось {task.target_count - progress.current_count} "
                        f"из {task.target_count}. Награда +{task.reward_likes} лайк(ов)."
                    ),
                    task_id=task.id,
                    sent_on=today,
                ):
                    sent_count += 1
                continue

            if progress.current_count > 0 and _period_ends_soon(task, today=today):
                if await _notify_task(
                    db,
                    user_id=user.id,
                    kind="reminder_expiring",
                    title="Успейте выполнить",
                    message=(
                        f"«{task.title}» скоро завершится. Прогресс: "
                        f"{progress.current_count}/{task.target_count}."
                    ),
                    task_id=task.id,
                    sent_on=today,
                ):
                    sent_count += 1

    await db.commit()
    logger.info("Вечерние напоминания о заданиях: %s уведомлений", sent_count)
    return sent_count


async def admin_complete_task_for_user(
    db: AsyncSession,
    *,
    task_id: int,
    user_id: int,
) -> models.UserTaskProgress:
    """Отмечает кастомное задание выполненным администратором."""
    result = await db.execute(select(models.Task).where(models.Task.id == task_id))
    task = result.scalars().first()
    if not task:
        raise ValueError("Задание не найдено")
    if task.is_system:
        raise ValueError("Системное задание отмечается автоматически")

    user = await db.get(models.User, user_id)
    if not user:
        raise ValueError("Пользователь не найден")

    progress = await task_service._get_progress_row(db, user_id, task)
    if progress.completed_at is None:
        progress.current_count = task.target_count
        progress.completed_at = datetime.utcnow()
        await task_service._grant_task_reward(db, user, task, progress)
        await notify_task_completed(db, user_id, task)

    await db.commit()
    await db.refresh(progress)
    return progress
