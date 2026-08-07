"""Встроенный планировщик уведомлений по заданиям (Europe/Moscow, без внешнего cron)."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Callable, Awaitable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from zoneinfo import ZoneInfo

import task_notification_service
from config import settings
from database import AsyncSessionLocal, engine

logger = logging.getLogger(__name__)

_TASK_TZ = ZoneInfo("Europe/Moscow")
_MORNING_LOCK_KEY = 1234567901
_EVENING_LOCK_KEY = 1234567902

ScheduledJob = tuple[str, int, int, int, Callable[[AsyncSession], Awaitable[int]]]


def _scheduled_jobs() -> list[ScheduledJob]:
    """Возвращает расписание: имя, час, минута, lock, обработчик."""
    return [
        (
            "morning",
            settings.TASK_MORNING_HOUR,
            settings.TASK_MORNING_MINUTE,
            _MORNING_LOCK_KEY,
            task_notification_service.send_morning_task_refresh_notifications,
        ),
        (
            "evening",
            settings.TASK_EVENING_HOUR,
            settings.TASK_EVENING_MINUTE,
            _EVENING_LOCK_KEY,
            task_notification_service.send_evening_task_reminder_notifications,
        ),
    ]


def _next_run_at(hour: int, minute: int, *, now: datetime) -> datetime:
    """Ближайшее время запуска для заданного часа и минуты в Europe/Moscow."""
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def _pick_next_job(now: datetime) -> tuple[str, datetime, int, Callable[[AsyncSession], Awaitable[int]]]:
    """Выбирает ближайшее задание из расписания."""
    best_name = ""
    best_at = now + timedelta(days=365)
    best_lock = 0
    best_handler: Callable[[AsyncSession], Awaitable[int]] | None = None

    for name, hour, minute, lock_key, handler in _scheduled_jobs():
        run_at = _next_run_at(hour, minute, now=now)
        if run_at < best_at:
            best_name = name
            best_at = run_at
            best_lock = lock_key
            best_handler = handler

    if best_handler is None:
        raise RuntimeError("Расписание уведомлений по заданиям пусто")

    return best_name, best_at, best_lock, best_handler


async def _run_job_with_lock(
    lock_key: int,
    job_name: str,
    handler: Callable[[AsyncSession], Awaitable[int]],
) -> None:
    """Выполняет задачу, если удалось взять advisory lock (защита от дублей на нескольких инстансах)."""
    async with engine.connect() as conn:
        lock_result = await conn.execute(text(f"SELECT pg_try_advisory_lock({lock_key})"))
        acquired = bool(lock_result.scalar())
        if not acquired:
            logger.info("Планировщик %s: пропуск — задачу выполняет другой инстанс", job_name)
            return

        try:
            async with AsyncSessionLocal() as db:
                sent = await handler(db)
            logger.info("Планировщик %s: отправлено уведомлений — %s", job_name, sent)
        except Exception:
            logger.exception("Планировщик %s: ошибка выполнения", job_name)
        finally:
            await conn.execute(text(f"SELECT pg_advisory_unlock({lock_key})"))


async def _scheduler_loop() -> None:
    """Основной цикл: ждёт ближайший слот и запускает соответствующую задачу."""
    logger.info(
        "Планировщик заданий запущен (МСК %02d:%02d и %02d:%02d)",
        settings.TASK_MORNING_HOUR,
        settings.TASK_MORNING_MINUTE,
        settings.TASK_EVENING_HOUR,
        settings.TASK_EVENING_MINUTE,
    )

    while True:
        now = datetime.now(_TASK_TZ)
        job_name, run_at, lock_key, handler = _pick_next_job(now)
        wait_seconds = max(1.0, (run_at - now).total_seconds())
        logger.info(
            "Планировщик: следующий запуск «%s» в %s (через %.0f с)",
            job_name,
            run_at.isoformat(),
            wait_seconds,
        )
        await asyncio.sleep(wait_seconds)
        await _run_job_with_lock(lock_key, job_name, handler)


def start_task_notification_scheduler(app) -> None:
    """Запускает фоновый планировщик после готовности приложения."""
    if not settings.TASK_SCHEDULER_ENABLED:
        logger.info("TASK_SCHEDULER_ENABLED=false — встроенный планировщик не запускается")
        return

    task = asyncio.create_task(_scheduler_loop())
    app.state._task_scheduler_task = task


async def stop_task_notification_scheduler(app) -> None:
    """Останавливает планировщик при завершении процесса."""
    task = getattr(app.state, "_task_scheduler_task", None)
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
