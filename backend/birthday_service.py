"""Поздравления с днём рождения: бонус, push и лента."""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import extract, select
from sqlalchemy.ext.asyncio import AsyncSession

import crud
import models
import schemas
from avatar_service import resolve_public_avatar_url
from bot import escape_html, send_telegram_message

logger = logging.getLogger(__name__)

_MSK_TZ = ZoneInfo("Europe/Moscow")
_BIRTHDAY_BONUS = 15


def moscow_today() -> date:
    """Текущая календарная дата по Москве."""
    return datetime.now(_MSK_TZ).date()


def birthday_push_tag(user_id: int, year: int) -> str:
    """Стабильный tag push-уведомления на один день рождения."""
    return f"birthday-{user_id}-{year}"


async def list_today_birthday_users(db: AsyncSession) -> list[models.User]:
    """Возвращает одобренных пользователей с днём рождения сегодня (МСК)."""
    today = moscow_today()
    result = await db.execute(
        select(models.User).where(
            models.User.status == "approved",
            models.User.date_of_birth.isnot(None),
            extract("month", models.User.date_of_birth) == today.month,
            extract("day", models.User.date_of_birth) == today.day,
        ),
    )
    return list(result.scalars().all())


def _birthday_bonus_already_given(user: models.User, today: date) -> bool:
    """Проверяет, начислялся ли уже бонус ко дню рождения сегодня."""
    return user.last_birthday_bonus_date == today


def _display_name(user: models.User) -> str:
    """Имя для поздравления в UI и push."""
    parts = [user.first_name or "", user.last_name or ""]
    name = " ".join(part for part in parts if part).strip()
    if name:
        return name
    if user.username:
        return f"@{user.username}"
    return "коллега"


async def process_birthday_bonuses(db: AsyncSession) -> int:
    """Начисляет бонус, шлёт push/Telegram и создаёт in-app уведомление."""
    today = moscow_today()
    users = await list_today_birthday_users(db)
    processed = 0

    for user in users:
        if _birthday_bonus_already_given(user, today):
            continue

        user.balance += _BIRTHDAY_BONUS
        user.last_birthday_bonus_date = today
        name = _display_name(user)
        push_tag = birthday_push_tag(user.id, today.year)

        if user.telegram_id and user.telegram_id >= 0:
            birthday_message = (
                f"🎉 <b>С Днём Рождения!</b> 🎂\n\n"
                f"Дорогой/ая <b>{escape_html(name)}</b>, поздравляем вас с днём рождения!\n\n"
                f"🎁 В честь праздника начислено <b>{_BIRTHDAY_BONUS} спасибок</b>!\n\n"
                f"Желаем здоровья, счастья и успехов! 🎈"
            )
            try:
                await send_telegram_message(user.telegram_id, birthday_message)
            except Exception as exc:
                logger.error(
                    "Не удалось отправить поздравление в Telegram user_id=%s: %s",
                    user.id,
                    exc,
                )

        await crud._create_notification(
            db,
            user.id,
            "birthday",
            "С Днём Рождения!",
            f"Поздравляем! Вам начислено {_BIRTHDAY_BONUS} спасибок в подарок.",
            click_url="/?panel=home",
            push_tag=push_tag,
        )
        processed += 1

    if processed:
        await db.commit()
        await crud._invalidate_feed_and_leaderboard("бонусы ко дню рождения")

    logger.info("Дни рождения: обработано %s из %s", processed, len(users))
    return processed


def birthday_feed_item(user: models.User) -> schemas.BirthdayFeedItem:
    """DTO именинника для объединённой ленты."""
    user_dto = schemas.UserBase.model_validate(user)
    user_dto = user_dto.model_copy(
        update={"telegram_photo_url": resolve_public_avatar_url(user)},
    )
    return schemas.BirthdayFeedItem(
        user_id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        username=user.username,
        telegram_photo_url=user_dto.telegram_photo_url,
        bonus_amount=_BIRTHDAY_BONUS,
        display_name=_display_name(user),
    )


def birthday_stream_timestamp() -> datetime:
    """Метка времени для карточек дня рождения (09:00 МСК текущего дня, UTC naive)."""
    today = moscow_today()
    local_start = datetime.combine(today, time(hour=9, minute=0), tzinfo=_MSK_TZ)
    return local_start.astimezone(timezone.utc).replace(tzinfo=None)
