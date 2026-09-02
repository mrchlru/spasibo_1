"""Push-напоминания о неиспользованном дневном лимите «спасибок»."""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import crud
import models

logger = logging.getLogger(__name__)

_MSK_TZ = ZoneInfo("Europe/Moscow")
_DAILY_TRANSFER_LIMIT = 3
ReminderSlot = Literal["morning", "evening"]


def _moscow_today() -> date:
    """Текущая календарная дата по Москве."""
    return datetime.now(_MSK_TZ).date()


def _effective_daily_transfer_count(user: models.User, today: date) -> int:
    """Сколько переводов пользователь уже сделал сегодня (с учётом смены дня)."""
    if user.daily_transfer_count_for_date != today:
        return 0
    return int(user.daily_transfer_count or 0)


def _build_reminder_copy(slot: ReminderSlot, remaining: int) -> tuple[str, str]:
    """Формирует заголовок и текст напоминания."""
    if slot == "morning":
        title = "Поблагодарите коллег"
        if remaining == 1:
            message = "У вас осталась 1 спасибка на сегодня — отправьте её коллеге!"
        else:
            message = (
                f"У вас осталось {remaining} спасибок на сегодня — "
                "поблагодарите коллег!"
            )
        return title, message

    title = "Не забудьте отправить спасибки"
    if remaining == 1:
        message = "День заканчивается — у вас ещё 1 спасибка. Отправьте её коллеге!"
    else:
        message = (
            f"День заканчивается — у вас ещё {remaining} спасибок. "
            "Не забудьте поблагодарить коллег!"
        )
    return title, message


async def send_daily_transfer_reminders(
    db: AsyncSession,
    slot: ReminderSlot,
) -> int:
    """Рассылает напоминания пользователям с неиспользованным дневным лимитом.

    Args:
        db: Сессия БД.
        slot: ``morning`` (11:00 МСК) или ``evening`` (21:00 МСК).

    Returns:
        Число пользователей, которым создано уведомление.
    """
    today = _moscow_today()
    tag_prefix = "daily-transfer-am" if slot == "morning" else "daily-transfer-pm"
    push_tag = f"{tag_prefix}-{today.isoformat()}"

    result = await db.execute(
        select(models.User).where(models.User.status == "approved"),
    )
    users = result.scalars().all()

    sent = 0
    for user in users:
        used = _effective_daily_transfer_count(user, today)
        remaining = _DAILY_TRANSFER_LIMIT - used
        if remaining <= 0:
            continue

        title, message = _build_reminder_copy(slot, remaining)
        await crud._create_notification(
            db,
            user.id,
            "system",
            title,
            message,
            click_url="/?panel=transfer",
            push_tag=push_tag,
        )
        sent += 1

    if sent:
        await db.commit()
    logger.info(
        "Напоминания о лимите (%s): отправлено %s пользователям",
        slot,
        sent,
    )
    return sent
