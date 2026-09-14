"""Fair play: детекция и санкции за злоупотребление «спасибками»."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Literal, Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from zoneinfo import ZoneInfo

import models

logger = logging.getLogger(__name__)

_MSK = ZoneInfo("Europe/Moscow")
_STRIKE_RESET_DAYS = 90
_CONFIRMED_SENDERS = 3
_SUSPICIOUS_SENDERS = 2
_BAN_DAYS_STRIKE1 = 3
_BAN_DAYS_STRIKE2 = 7
_LIMIT_DAYS = 7
_DAILY_CAP_STRIKE1 = 2
_WEEKLY_CAP_STRIKE2 = 1
_DEFAULT_DAILY_LIMIT = 3
_SENDER_PATTERN_MIN_DAYS = 2
_SENDER_PATTERN_WINDOW_DAYS = 7
_SENDER_PATTERN_DAILY_MAX = 3
_SUSPICIOUS_TTL_DAYS = 14

BAN_REASON = (
    "получение большого числа благодарностей от разных коллег за один день "
    "(подозрение на искусственную «карусель»)"
)
LIMIT_REASON = (
    "регулярная отправка максимального числа спасибок одному и тому же коллеге"
)


def _now_utc() -> datetime:
    return datetime.utcnow()


def msk_calendar_date(when: Optional[datetime] = None) -> date:
    """Календарная дата по Europe/Moscow."""
    dt = when or _now_utc()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt.astimezone(_MSK).date()


def _msk_week_start(day: date) -> date:
    """Понедельник недели (МСК) для календарной даты."""
    return day - timedelta(days=day.weekday())


def is_birthday_today(user: models.User, today: Optional[date] = None) -> bool:
    """True, если сегодня (МСК) день рождения пользователя."""
    dob = user.date_of_birth
    if dob is None:
        return False
    today = today or msk_calendar_date()
    return dob.month == today.month and dob.day == today.day


def _maybe_reset_strikes(user: models.User, now: Optional[datetime] = None) -> None:
    """Сбрасывает strike_count после 90 дней без нарушений."""
    now = now or _now_utc()
    if user.fair_play_last_violation_at is None:
        return
    if user.fair_play_last_violation_at + timedelta(days=_STRIKE_RESET_DAYS) <= now:
        user.fair_play_strike_count = 0
        user.fair_play_last_violation_at = None


def refresh_expired_sanctions(user: models.User, now: Optional[datetime] = None) -> None:
    """Снимает истёкшие бан/лимит и устаревшую «подозрительность»."""
    now = now or _now_utc()
    _maybe_reset_strikes(user, now)
    if user.fair_play_ban_until and user.fair_play_ban_until <= now:
        user.fair_play_ban_until = None
    if user.fair_play_limit_until and user.fair_play_limit_until <= now:
        user.fair_play_limit_mode = None
        user.fair_play_limit_cap = None
        user.fair_play_limit_until = None
        user.fair_play_weekly_sent_count = 0
        user.fair_play_weekly_sent_for_date = None
    if user.fair_play_suspicious_at:
        if user.fair_play_suspicious_at + timedelta(days=_SUSPICIOUS_TTL_DAYS) <= now:
            user.fair_play_suspicious_at = None


def is_fair_play_banned(user: models.User, now: Optional[datetime] = None) -> bool:
    """Пользователь под fair-play баном (не может отправлять и получать)."""
    now = now or _now_utc()
    return bool(user.fair_play_ban_until and user.fair_play_ban_until > now)


def is_suspicious_active(user: models.User, now: Optional[datetime] = None) -> bool:
    """«Замечена подозрительная активность» — пограничный случай."""
    now = now or _now_utc()
    if not user.fair_play_suspicious_at:
        return False
    return user.fair_play_suspicious_at + timedelta(days=_SUSPICIOUS_TTL_DAYS) > now


def strike_reset_at(user: models.User) -> Optional[datetime]:
    """Дата автосброса strikes (last_violation + 90 дней)."""
    if user.fair_play_last_violation_at is None:
        return None
    return user.fair_play_last_violation_at + timedelta(days=_STRIKE_RESET_DAYS)


def get_effective_daily_limit(user: models.User, now: Optional[datetime] = None) -> int:
    """Дневной лимит отправок с учётом fair-play ограничений."""
    now = now or _now_utc()
    refresh_expired_sanctions(user, now)
    if is_fair_play_banned(user, now):
        return 0
    if (
        user.fair_play_limit_mode == "daily"
        and user.fair_play_limit_cap
        and user.fair_play_limit_until
        and user.fair_play_limit_until > now
    ):
        return user.fair_play_limit_cap
    return _DEFAULT_DAILY_LIMIT


def _assert_not_fair_play_banned(user: models.User, role: Literal["sender", "receiver"]) -> None:
    refresh_expired_sanctions(user)
    if not is_fair_play_banned(user):
        return
    until = user.fair_play_ban_until
    until_str = until.strftime("%d.%m.%Y %H:%M") if until else "—"
    if role == "sender":
        raise ValueError(
            f"Вы временно заблокированы в связи с {BAN_REASON} до {until_str} (МСК). "
            "Отправка спасибок недоступна."
        )
    raise ValueError(
        f"Пользователь временно заблокирован в связи с {BAN_REASON} до {until_str} (МСК)."
    )


def assert_sender_may_send(db: AsyncSession, sender: models.User) -> None:
    """Проверяет, может ли отправитель совершить перевод."""
    refresh_expired_sanctions(sender)
    _assert_not_fair_play_banned(sender, "sender")

    now = _now_utc()
    if (
        sender.fair_play_limit_mode == "weekly"
        and sender.fair_play_limit_cap == _WEEKLY_CAP_STRIKE2
        and sender.fair_play_limit_until
        and sender.fair_play_limit_until > now
    ):
        week_start = _msk_week_start(msk_calendar_date())
        if sender.fair_play_weekly_sent_for_date != week_start:
            sender.fair_play_weekly_sent_count = 0
            sender.fair_play_weekly_sent_for_date = week_start
        if sender.fair_play_weekly_sent_count >= _WEEKLY_CAP_STRIKE2:
            until_str = sender.fair_play_limit_until.strftime("%d.%m.%Y %H:%M")
            raise ValueError(
                f"Действует ограничение: 1 спасибо в неделю до {until_str} (МСК). "
                f"Причина: {LIMIT_REASON}."
            )


def assert_receiver_may_receive(receiver: models.User) -> None:
    """Проверяет, может ли получатель принять перевод."""
    refresh_expired_sanctions(receiver)
    _assert_not_fair_play_banned(receiver, "receiver")


def record_sender_weekly_usage(sender: models.User) -> None:
    """Учитывает отправку при недельном лимите."""
    now = _now_utc()
    if not (
        sender.fair_play_limit_mode == "weekly"
        and sender.fair_play_limit_cap == _WEEKLY_CAP_STRIKE2
        and sender.fair_play_limit_until
        and sender.fair_play_limit_until > now
    ):
        return
    week_start = _msk_week_start(msk_calendar_date())
    if sender.fair_play_weekly_sent_for_date != week_start:
        sender.fair_play_weekly_sent_count = 0
        sender.fair_play_weekly_sent_for_date = week_start
    sender.fair_play_weekly_sent_count += 1


async def _count_distinct_senders_today(
    db: AsyncSession,
    receiver_id: int,
    day: date,
) -> int:
    """Число разных отправителей, переводивших получателю за календарный день МСК."""
    moscow_day = func.date(
        models.Transaction.timestamp.op("AT TIME ZONE")("UTC").op("AT TIME ZONE")("Europe/Moscow")
    )
    q = (
        select(func.count(func.distinct(models.Transaction.sender_id)))
        .where(
            models.Transaction.receiver_id == receiver_id,
            moscow_day == day,
        )
    )
    return (await db.execute(q)).scalar_one()


async def _sender_ids_today(
    db: AsyncSession,
    receiver_id: int,
    day: date,
) -> list[int]:
    moscow_day = func.date(
        models.Transaction.timestamp.op("AT TIME ZONE")("UTC").op("AT TIME ZONE")("Europe/Moscow")
    )
    q = (
        select(models.Transaction.sender_id)
        .where(
            models.Transaction.receiver_id == receiver_id,
            moscow_day == day,
        )
        .distinct()
    )
    return list((await db.execute(q)).scalars().all())


async def _count_days_with_max_sends_to_receiver(
    db: AsyncSession,
    sender_id: int,
    receiver_id: int,
    window_days: int = _SENDER_PATTERN_WINDOW_DAYS,
) -> int:
    """Сколько дней за окно отправитель исчерпал дневной лимит (3) в пользу одного получателя."""
    today = msk_calendar_date()
    since = today - timedelta(days=window_days - 1)
    moscow_day = func.date(
        models.Transaction.timestamp.op("AT TIME ZONE")("UTC").op("AT TIME ZONE")("Europe/Moscow")
    )
    daily_counts = (
        select(
            moscow_day.label("day"),
            func.count(models.Transaction.id).label("cnt"),
        )
        .where(
            models.Transaction.sender_id == sender_id,
            models.Transaction.receiver_id == receiver_id,
            moscow_day >= since,
            moscow_day <= today,
        )
        .group_by(moscow_day)
        .subquery()
    )
    q = select(func.count()).select_from(daily_counts).where(
        daily_counts.c.cnt >= _SENDER_PATTERN_DAILY_MAX
    )
    return (await db.execute(q)).scalar_one()


async def _log_audit(
    db: AsyncSession,
    user_id: int,
    event_type: str,
    related_user_id: Optional[int] = None,
    details: Optional[dict] = None,
) -> None:
    db.add(
        models.FairPlayAuditLog(
            user_id=user_id,
            event_type=event_type,
            related_user_id=related_user_id,
            details=details,
        )
    )


async def _receiver_event_exists(
    db: AsyncSession,
    receiver_id: int,
    trigger_date: date,
) -> bool:
    q = select(models.FairPlayReceiverEvent.id).where(
        models.FairPlayReceiverEvent.receiver_id == receiver_id,
        models.FairPlayReceiverEvent.trigger_date == trigger_date,
    )
    return (await db.execute(q)).scalar_one_or_none() is not None


def _increment_strike_and_touch(user: models.User, now: datetime) -> int:
    _maybe_reset_strikes(user, now)
    user.fair_play_strike_count = (user.fair_play_strike_count or 0) + 1
    user.fair_play_last_violation_at = now
    return user.fair_play_strike_count


def _apply_receiver_ban(user: models.User, now: datetime) -> None:
    strike = _increment_strike_and_touch(user, now)
    ban_days = _BAN_DAYS_STRIKE1 if strike <= 1 else _BAN_DAYS_STRIKE2
    user.fair_play_ban_until = now + timedelta(days=ban_days)
    user.fair_play_suspicious_at = None


def _apply_sender_limit(user: models.User, now: datetime) -> None:
    strike = _increment_strike_and_touch(user, now)
    user.fair_play_limit_until = now + timedelta(days=_LIMIT_DAYS)
    user.fair_play_suspicious_at = None
    if strike <= 1:
        user.fair_play_limit_mode = "daily"
        user.fair_play_limit_cap = _DAILY_CAP_STRIKE1
    else:
        user.fair_play_limit_mode = "weekly"
        user.fair_play_limit_cap = _WEEKLY_CAP_STRIKE2
        user.fair_play_weekly_sent_count = 0
        user.fair_play_weekly_sent_for_date = _msk_week_start(msk_calendar_date(now))


def _mark_suspicious(user: models.User, now: datetime) -> None:
    if is_fair_play_banned(user, now):
        return
    user.fair_play_suspicious_at = now


async def analyze_transfer(
    db: AsyncSession,
    sender: models.User,
    receiver: models.User,
) -> None:
    """Анализ перевода после успешного создания (до commit)."""
    now = _now_utc()
    today = msk_calendar_date(now)

    if is_birthday_today(receiver, today):
        return

    distinct_count = await _count_distinct_senders_today(db, receiver.id, today)

    if distinct_count == _SUSPICIOUS_SENDERS:
        sender_ids = await _sender_ids_today(db, receiver.id, today)
        _mark_suspicious(receiver, now)
        for sid in sender_ids:
            u = await db.get(models.User, sid)
            if u:
                _mark_suspicious(u, now)
        await _log_audit(
            db,
            receiver.id,
            "suspicious",
            related_user_id=sender.id,
            details={"distinct_senders": distinct_count, "trigger_date": today.isoformat()},
        )
        return

    if distinct_count < _CONFIRMED_SENDERS:
        return

    if await _receiver_event_exists(db, receiver.id, today):
        return

    db.add(
        models.FairPlayReceiverEvent(
            receiver_id=receiver.id,
            trigger_date=today,
            distinct_sender_count=distinct_count,
        )
    )

    _apply_receiver_ban(receiver, now)
    await _log_audit(
        db,
        receiver.id,
        "ban",
        details={
            "distinct_senders": distinct_count,
            "ban_until": receiver.fair_play_ban_until.isoformat() if receiver.fair_play_ban_until else None,
            "strike": receiver.fair_play_strike_count,
        },
    )

    sender_ids = await _sender_ids_today(db, receiver.id, today)
    for sid in sender_ids:
        sender_user = await db.get(models.User, sid)
        if not sender_user:
            continue
        abuse_days = await _count_days_with_max_sends_to_receiver(
            db, sender_user.id, receiver.id
        )
        if abuse_days >= _SENDER_PATTERN_MIN_DAYS:
            _apply_sender_limit(sender_user, now)
            await _log_audit(
                db,
                sender_user.id,
                "limit",
                related_user_id=receiver.id,
                details={
                    "abuse_days": abuse_days,
                    "limit_until": sender_user.fair_play_limit_until.isoformat()
                    if sender_user.fair_play_limit_until
                    else None,
                    "mode": sender_user.fair_play_limit_mode,
                    "cap": sender_user.fair_play_limit_cap,
                },
            )


def build_fair_play_status(user: models.User) -> dict:
    """Сериализуемый статус fair play для API."""
    now = _now_utc()
    refresh_expired_sanctions(user, now)
    limited = bool(
        user.fair_play_limit_until
        and user.fair_play_limit_until > now
        and user.fair_play_limit_mode
        and user.fair_play_limit_cap
    )
    return {
        "is_fair_play_banned": is_fair_play_banned(user, now),
        "ban_until": user.fair_play_ban_until,
        "ban_reason": BAN_REASON if is_fair_play_banned(user, now) else None,
        "limit_mode": user.fair_play_limit_mode if limited else None,
        "limit_cap": user.fair_play_limit_cap if limited else None,
        "limit_until": user.fair_play_limit_until if limited else None,
        "limit_reason": LIMIT_REASON if limited else None,
        "suspicious_active": is_suspicious_active(user, now),
        "suspicious_at": user.fair_play_suspicious_at if is_suspicious_active(user, now) else None,
        "strike_count": user.fair_play_strike_count or 0,
        "strike_reset_at": strike_reset_at(user),
        "effective_daily_limit": get_effective_daily_limit(user, now),
    }


def build_fair_play_public_hint(user: models.User) -> dict:
    """Минимальные поля для списка пользователей при отправке спасибок."""
    now = _now_utc()
    refresh_expired_sanctions(user, now)
    return {
        "is_fair_play_banned": is_fair_play_banned(user, now),
        "ban_until": user.fair_play_ban_until if is_fair_play_banned(user, now) else None,
        "ban_reason": BAN_REASON if is_fair_play_banned(user, now) else None,
        "suspicious_active": is_suspicious_active(user, now),
    }


async def admin_lift_ban(db: AsyncSession, user: models.User) -> None:
    user.fair_play_ban_until = None
    await _log_audit(db, user.id, "admin_lift_ban")


async def admin_lift_limit(db: AsyncSession, user: models.User) -> None:
    user.fair_play_limit_mode = None
    user.fair_play_limit_cap = None
    user.fair_play_limit_until = None
    user.fair_play_weekly_sent_count = 0
    user.fair_play_weekly_sent_for_date = None
    await _log_audit(db, user.id, "admin_lift_limit")


async def admin_clear_suspicious(db: AsyncSession, user: models.User) -> None:
    user.fair_play_suspicious_at = None
    await _log_audit(db, user.id, "admin_clear_suspicious")


async def admin_reset_strikes(db: AsyncSession, user: models.User) -> None:
    user.fair_play_strike_count = 0
    user.fair_play_last_violation_at = None
    await _log_audit(db, user.id, "admin_reset_strikes")


async def sync_user_sanctions(db: AsyncSession, user: models.User) -> None:
    """Снимает истёкшие санкции и сохраняет изменения в БД."""
    refresh_expired_sanctions(user)
    await db.commit()
    await db.refresh(user)


async def get_fair_play_dashboard_counts(db: AsyncSession) -> dict:
    """Счётчики для дашборда админки."""
    now = _now_utc()
    suspicious_cutoff = now - timedelta(days=_SUSPICIOUS_TTL_DAYS)

    banned = (
        await db.execute(
            select(func.count(models.User.id)).where(
                models.User.fair_play_ban_until.isnot(None),
                models.User.fair_play_ban_until > now,
                models.User.status == "approved",
            )
        )
    ).scalar_one()

    limited = (
        await db.execute(
            select(func.count(models.User.id)).where(
                models.User.fair_play_limit_until.isnot(None),
                models.User.fair_play_limit_until > now,
                models.User.status == "approved",
            )
        )
    ).scalar_one()

    suspicious = (
        await db.execute(
            select(func.count(models.User.id)).where(
                models.User.fair_play_suspicious_at.isnot(None),
                models.User.fair_play_suspicious_at > suspicious_cutoff,
                models.User.status == "approved",
            )
        )
    ).scalar_one()

    return {
        "fair_play_banned_count": banned,
        "fair_play_limited_count": limited,
        "fair_play_suspicious_count": suspicious,
    }


async def list_fair_play_users(
    db: AsyncSession,
    sanction: Literal["all", "banned", "limited", "suspicious"] = "all",
) -> list[models.User]:
    """Пользователи с активными fair-play санкциями."""
    now = _now_utc()
    suspicious_cutoff = now - timedelta(days=_SUSPICIOUS_TTL_DAYS)
    conditions = [models.User.status == "approved"]

    if sanction == "banned":
        conditions.append(
            and_(
                models.User.fair_play_ban_until.isnot(None),
                models.User.fair_play_ban_until > now,
            )
        )
    elif sanction == "limited":
        conditions.append(
            and_(
                models.User.fair_play_limit_until.isnot(None),
                models.User.fair_play_limit_until > now,
            )
        )
    elif sanction == "suspicious":
        conditions.append(
            and_(
                models.User.fair_play_suspicious_at.isnot(None),
                models.User.fair_play_suspicious_at > suspicious_cutoff,
            )
        )
    else:
        conditions.append(
            or_(
                and_(
                    models.User.fair_play_ban_until.isnot(None),
                    models.User.fair_play_ban_until > now,
                ),
                and_(
                    models.User.fair_play_limit_until.isnot(None),
                    models.User.fair_play_limit_until > now,
                ),
                and_(
                    models.User.fair_play_suspicious_at.isnot(None),
                    models.User.fair_play_suspicious_at > suspicious_cutoff,
                ),
            )
        )

    q = select(models.User).where(*conditions).order_by(models.User.last_name, models.User.first_name)
    return list((await db.execute(q)).scalars().all())
