"""Встроенный планировщик фоновых задач приложения (без внешнего cron)."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from sqlalchemy import text

from config import settings
from database import AsyncSessionLocal

logger = logging.getLogger(__name__)

_MSK_TZ = ZoneInfo("Europe/Moscow")
_AVATAR_REFRESH_LOCK_KEY = 1234567892
_AVATAR_REFRESH_HOUR = 2
_AVATAR_REFRESH_MINUTE = 0


def _seconds_until_next_moscow_time(*, hour: int, minute: int) -> float:
    """Возвращает секунды до ближайшего запуска в указанное время по МСК."""
    now = datetime.now(_MSK_TZ)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return max((target - now).total_seconds(), 1.0)


async def _run_avatar_refresh_job() -> None:
    """Обновляет устаревшие аватары; один воркер за счёт advisory lock."""
    import avatar_service

    async with AsyncSessionLocal() as db:
        lock_result = await db.execute(
            text("SELECT pg_try_advisory_lock(:key)"),
            {"key": _AVATAR_REFRESH_LOCK_KEY},
        )
        if not lock_result.scalar():
            logger.info("Планировщик аватаров: задача уже выполняется на другом воркере")
            return

        try:
            updated = await avatar_service.refresh_all_user_avatars(db)
            logger.info("Планировщик аватаров: обновлено %s пользователей", updated)
        except Exception:
            logger.exception("Планировщик аватаров: ошибка при обновлении")
        finally:
            await db.execute(
                text("SELECT pg_advisory_unlock(:key)"),
                {"key": _AVATAR_REFRESH_LOCK_KEY},
            )
            await db.commit()


async def _avatar_refresh_loop(stop_event: asyncio.Event) -> None:
    """Каждый день в 02:00 МСК обновляет аватары старше 30 дней."""
    while not stop_event.is_set():
        delay = _seconds_until_next_moscow_time(
            hour=_AVATAR_REFRESH_HOUR,
            minute=_AVATAR_REFRESH_MINUTE,
        )
        logger.info(
            "Планировщик аватаров: следующий запуск через %.0f с (02:00 МСК)",
            delay,
        )
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=delay)
            break
        except asyncio.TimeoutError:
            pass

        if stop_event.is_set():
            break
        await _run_avatar_refresh_job()


async def _scheduler_main(app: FastAPI, stop_event: asyncio.Event) -> None:
    """Ждёт готовности приложения и запускает циклы задач."""
    while not getattr(app.state, "startup_ready", False):
        if stop_event.is_set():
            return
        await asyncio.sleep(1)

    if stop_event.is_set():
        return

    logger.info("Встроенный планировщик запущен")
    await _avatar_refresh_loop(stop_event)


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
