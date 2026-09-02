"""Встроенный планировщик фоновых задач приложения (без внешнего cron)."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from sqlalchemy import text

from config import settings
from database import AsyncSessionLocal

logger = logging.getLogger(__name__)

_MSK_TZ = ZoneInfo("Europe/Moscow")
_AVATAR_REFRESH_LOCK_KEY = 1234567892
_MORNING_REMINDER_LOCK_KEY = 1234567893
_EVENING_REMINDER_LOCK_KEY = 1234567894
_BIRTHDAY_BONUS_LOCK_KEY = 1234567895
_AVATAR_REFRESH_HOUR = 2
_AVATAR_REFRESH_MINUTE = 0
_MORNING_REMINDER_HOUR = 11
_MORNING_REMINDER_MINUTE = 0
_BIRTHDAY_BONUS_HOUR = 9
_BIRTHDAY_BONUS_MINUTE = 0
_EVENING_REMINDER_HOUR = 21
_EVENING_REMINDER_MINUTE = 0


def _seconds_until_next_moscow_time(*, hour: int, minute: int) -> float:
    """Возвращает секунды до ближайшего запуска в указанное время по МСК."""
    now = datetime.now(_MSK_TZ)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return max((target - now).total_seconds(), 1.0)


async def _run_with_advisory_lock(
    lock_key: int,
    job_name: str,
    job: Callable[[], Awaitable[None]],
) -> None:
    """Выполняет задачу, если удалось захватить advisory lock."""
    async with AsyncSessionLocal() as db:
        lock_result = await db.execute(
            text("SELECT pg_try_advisory_lock(:key)"),
            {"key": lock_key},
        )
        if not lock_result.scalar():
            logger.info("Планировщик %s: задача уже выполняется на другом воркере", job_name)
            return

        try:
            await job()
        except Exception:
            logger.exception("Планировщик %s: ошибка при выполнении", job_name)
        finally:
            await db.execute(
                text("SELECT pg_advisory_unlock(:key)"),
                {"key": lock_key},
            )
            await db.commit()


async def _run_avatar_refresh_job() -> None:
    """Обновляет устаревшие аватары."""
    import avatar_service

    async with AsyncSessionLocal() as db:
        updated = await avatar_service.refresh_all_user_avatars(db)
        logger.info("Планировщик аватаров: обновлено %s пользователей", updated)


async def _run_morning_reminder_job() -> None:
    """Утреннее напоминание о неиспользованном лимите спасибок."""
    import reminder_service

    async with AsyncSessionLocal() as db:
        await reminder_service.send_daily_transfer_reminders(db, "morning")


async def _run_evening_reminder_job() -> None:
    """Вечернее напоминание о неиспользованном лимите спасибок."""
    import reminder_service

    async with AsyncSessionLocal() as db:
        await reminder_service.send_daily_transfer_reminders(db, "evening")


async def _run_birthday_bonus_job() -> None:
    """Начисляет бонусы и поздравления ко дню рождения."""
    import crud

    async with AsyncSessionLocal() as db:
        await crud.process_birthday_bonuses(db)


async def _daily_moscow_job_loop(
    stop_event: asyncio.Event,
    *,
    hour: int,
    minute: int,
    job_name: str,
    job: Callable[[], Awaitable[None]],
    lock_key: int,
) -> None:
    """Ежедневный цикл задачи в фиксированное время по МСК."""
    while not stop_event.is_set():
        delay = _seconds_until_next_moscow_time(hour=hour, minute=minute)
        logger.info(
            "Планировщик %s: следующий запуск через %.0f с (%02d:%02d МСК)",
            job_name,
            delay,
            hour,
            minute,
        )
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=delay)
            break
        except asyncio.TimeoutError:
            pass

        if stop_event.is_set():
            break

        await _run_with_advisory_lock(lock_key, job_name, job)


async def _scheduler_main(app: FastAPI, stop_event: asyncio.Event) -> None:
    """Ждёт готовности приложения и запускает циклы задач."""
    while not getattr(app.state, "startup_ready", False):
        if stop_event.is_set():
            return
        await asyncio.sleep(1)

    if stop_event.is_set():
        return

    logger.info("Встроенный планировщик запущен")
    await asyncio.gather(
        _daily_moscow_job_loop(
            stop_event,
            hour=_AVATAR_REFRESH_HOUR,
            minute=_AVATAR_REFRESH_MINUTE,
            job_name="аватары",
            job=_run_avatar_refresh_job,
            lock_key=_AVATAR_REFRESH_LOCK_KEY,
        ),
        _daily_moscow_job_loop(
            stop_event,
            hour=_MORNING_REMINDER_HOUR,
            minute=_MORNING_REMINDER_MINUTE,
            job_name="напоминание 11:00",
            job=_run_morning_reminder_job,
            lock_key=_MORNING_REMINDER_LOCK_KEY,
        ),
        _daily_moscow_job_loop(
            stop_event,
            hour=_BIRTHDAY_BONUS_HOUR,
            minute=_BIRTHDAY_BONUS_MINUTE,
            job_name="день рождения 09:00",
            job=_run_birthday_bonus_job,
            lock_key=_BIRTHDAY_BONUS_LOCK_KEY,
        ),
        _daily_moscow_job_loop(
            stop_event,
            hour=_EVENING_REMINDER_HOUR,
            minute=_EVENING_REMINDER_MINUTE,
            job_name="напоминание 21:00",
            job=_run_evening_reminder_job,
            lock_key=_EVENING_REMINDER_LOCK_KEY,
        ),
    )


def start_internal_scheduler_background(app: FastAPI) -> None:
    """Запускает фоновый планировщик после успешного старта приложения."""
    if not settings.INTERNAL_SCHEDULER_ENABLED:
        logger.info("Встроенный планировщик отключён (INTERNAL_SCHEDULER_ENABLED=false)")
        return

    stop_event = asyncio.Event()
    app.state._internal_scheduler_stop = stop_event
    app.state._internal_scheduler_task = asyncio.create_task(
        _scheduler_main(app, stop_event),
    )


async def stop_internal_scheduler(app: FastAPI) -> None:
    """Останавливает фоновый планировщик при завершении приложения."""
    stop_event = getattr(app.state, "_internal_scheduler_stop", None)
    task = getattr(app.state, "_internal_scheduler_task", None)
    if stop_event is not None:
        stop_event.set()
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
