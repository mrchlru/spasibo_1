"""Состояние рекламы установки приложения на аккаунт пользователя."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

import models
import schemas

INSTALL_PROMO_SNOOZE_DAYS = 3


def _utcnow_naive() -> datetime:
    """UTC сейчас без tzinfo (как timestamps в БД)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _as_naive_utc(value: datetime | None) -> datetime | None:
    """Нормализует datetime к naive UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _is_snooze_active(snoozed_until: datetime | None, now: datetime) -> bool:
    """True, если snooze ещё действует."""
    return snoozed_until is not None and snoozed_until > now


def state_to_response(row: models.InstallPromoUserState | None) -> schemas.InstallPromoUserStateResponse:
    """Собирает DTO состояния из строки БД или пустого дефолта."""
    now = _utcnow_naive()
    if row is None:
        return schemas.InstallPromoUserStateResponse(
            is_done=False,
            done_reason=None,
            snoozed_until=None,
            is_snoozed=False,
            can_show=True,
        )
    snoozed_until = _as_naive_utc(row.snoozed_until)
    is_done = row.done_at is not None
    is_snoozed = _is_snooze_active(snoozed_until, now)
    return schemas.InstallPromoUserStateResponse(
        is_done=is_done,
        done_reason=row.done_reason,
        snoozed_until=snoozed_until,
        is_snoozed=is_snoozed and not is_done,
        can_show=(not is_done) and (not is_snoozed),
    )


async def get_install_promo_user_state(
    db: AsyncSession,
    user_id: int,
) -> schemas.InstallPromoUserStateResponse:
    """Возвращает состояние рекламы для пользователя."""
    row = await db.get(models.InstallPromoUserState, user_id)
    return state_to_response(row)


async def snooze_install_promo_for_user(
    db: AsyncSession,
    user_id: int,
    *,
    days: int = INSTALL_PROMO_SNOOZE_DAYS,
) -> schemas.InstallPromoUserStateResponse:
    """Ставит snooze на days дней (не укорачивает уже более длинный)."""
    now = _utcnow_naive()
    until = now + timedelta(days=max(1, days))
    row = await _get_or_create_row(db, user_id)
    if row.done_at is not None:
        return state_to_response(row)
    current = _as_naive_utc(row.snoozed_until)
    if current is None or current < until:
        row.snoozed_until = until
    row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return state_to_response(row)


async def mark_install_promo_done_for_user(
    db: AsyncSession,
    user_id: int,
    *,
    reason: str = "done",
) -> schemas.InstallPromoUserStateResponse:
    """Помечает цель промо выполненной на аккаунте."""
    now = _utcnow_naive()
    row = await _get_or_create_row(db, user_id)
    if row.done_at is None:
        row.done_at = now
        row.done_reason = (reason or "done")[:64]
    row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return state_to_response(row)


async def _get_or_create_row(
    db: AsyncSession,
    user_id: int,
) -> models.InstallPromoUserState:
    """Достаёт или создаёт строку состояния."""
    row = await db.get(models.InstallPromoUserState, user_id)
    if row is not None:
        return row
    row = models.InstallPromoUserState(user_id=user_id)
    db.add(row)
    await db.flush()
    return row
