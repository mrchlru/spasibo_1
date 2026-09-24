"""Реферальная кампания: ссылки, атрибуции, начисление бонусов."""

from __future__ import annotations

import logging
import secrets
import string
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlalchemy.orm.attributes import flag_modified

import models
import schemas
from app_settings_crud import get_app_settings, _parse_iso_datetime

logger = logging.getLogger(__name__)

_MSK = ZoneInfo("Europe/Moscow")
_CODE_ALPHABET = string.ascii_uppercase + string.digits
REFERRAL_PROMO_SNOOZE_DAYS = 3

STATUS_PENDING = "pending"
STATUS_IN_PROGRESS = "in_progress"
STATUS_REWARDED = "rewarded"

KIND_NEW = "new"
KIND_REACTIVATION = "reactivation"

STATUS_LABELS_RU = {
    STATUS_PENDING: "Ожидает одобрения",
    STATUS_IN_PROGRESS: "Выполняет условия",
    STATUS_REWARDED: "Бонус начислен",
}

KIND_LABELS_RU = {
    KIND_NEW: "Новый пользователь",
    KIND_REACTIVATION: "Возвращение в «Спасибо»",
}


def moscow_today() -> date:
    """Календарная дата МСК."""
    return datetime.now(_MSK).date()


def _utcnow() -> datetime:
    """UTC сейчас (aware)."""
    return datetime.now(timezone.utc)


def _utcnow_naive() -> datetime:
    """UTC сейчас без tzinfo."""
    return _utcnow().replace(tzinfo=None)


def _as_aware_utc(value: datetime | None) -> datetime | None:
    """Нормализует datetime к aware UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def default_referral_payload() -> schemas.ReferralCampaignPayload:
    """Дефолтные настройки реферальной кампании."""
    return schemas.ReferralCampaignPayload()


def normalize_referral_payload(raw: Any) -> schemas.ReferralCampaignPayload:
    """Приводит JSON из БД к payload."""
    if raw is None:
        return default_referral_payload()
    if isinstance(raw, schemas.ReferralCampaignPayload):
        return raw
    if not isinstance(raw, dict):
        return default_referral_payload()
    try:
        return schemas.ReferralCampaignPayload.model_validate(raw)
    except Exception:
        return default_referral_payload()


def campaign_key_from_payload(payload: schemas.ReferralCampaignPayload) -> str | None:
    """Ключ текущей кампании (started_at); без старта — None."""
    if not payload.started_at:
        return None
    return str(payload.started_at).strip() or None


def is_referral_campaign_accepting_new(payload: schemas.ReferralCampaignPayload) -> bool:
    """Можно ли сейчас принимать новые атрибуции по ссылкам."""
    if not payload.enabled:
        return False
    now = _utcnow()
    started = _parse_iso_datetime(payload.started_at) if payload.started_at else None
    ends = _parse_iso_datetime(payload.ends_at) if payload.ends_at else None
    if started is not None and now < started:
        return False
    if ends is not None and now >= ends:
        return False
    return True


def is_referral_promo_visible(payload: schemas.ReferralCampaignPayload) -> bool:
    """Показывать ли рекламный sheet (пока кампания принимает ссылки)."""
    return is_referral_campaign_accepting_new(payload)


def _generate_referral_code() -> str:
    """Генерирует короткий персональный код."""
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))


async def ensure_user_referral_code(db: AsyncSession, user: models.User) -> str:
    """Гарантирует наличие уникального referral_code у пользователя."""
    if user.referral_code:
        return user.referral_code
    for _ in range(12):
        code = _generate_referral_code()
        exists = await db.execute(
            select(models.User.id).where(models.User.referral_code == code).limit(1)
        )
        if exists.scalar_one_or_none() is not None:
            continue
        user.referral_code = code
        await db.flush()
        return code
    raise RuntimeError("Не удалось сгенерировать referral_code")


async def get_user_by_referral_code(
    db: AsyncSession,
    code: str,
) -> models.User | None:
    """Находит пользователя по реферальному коду."""
    normalized = (code or "").strip().upper()
    if not normalized:
        return None
    result = await db.execute(
        select(models.User).where(models.User.referral_code == normalized).limit(1)
    )
    return result.scalars().first()


async def _load_campaign(db: AsyncSession) -> schemas.ReferralCampaignPayload:
    """Читает настройки кампании (с авто-истечением через get_app_settings)."""
    settings_row = await get_app_settings(db)
    return normalize_referral_payload(settings_row.referral)


async def _last_activity_at(db: AsyncSession, user: models.User) -> datetime:
    """Момент последней активности: логин, отправка спасибки или регистрация."""
    candidates: list[datetime] = []
    login = _as_aware_utc(user.last_login_date)
    if login is not None:
        candidates.append(login)
    reg = _as_aware_utc(user.registration_date)
    if reg is not None:
        candidates.append(reg)
    result = await db.execute(
        select(func.max(models.Transaction.timestamp)).where(
            models.Transaction.sender_id == user.id
        )
    )
    last_send = _as_aware_utc(result.scalar_one_or_none())
    if last_send is not None:
        candidates.append(last_send)
    if not candidates:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    return max(candidates)


async def is_user_inactive_for_referral(
    db: AsyncSession,
    user: models.User,
    payload: schemas.ReferralCampaignPayload,
) -> bool:
    """True, если у пользователя не было активности N месяцев."""
    months = max(1, int(payload.inactive_months or 3))
    threshold = _utcnow() - timedelta(days=30 * months)
    last_activity = await _last_activity_at(db, user)
    return last_activity < threshold


async def _existing_attribution(
    db: AsyncSession,
    invitee_id: int,
    campaign_key: str,
) -> models.ReferralAttribution | None:
    """Атрибуция invitee в рамках кампании."""
    result = await db.execute(
        select(models.ReferralAttribution).where(
            models.ReferralAttribution.invitee_id == invitee_id,
            models.ReferralAttribution.campaign_key == campaign_key,
        ).limit(1)
    )
    return result.scalars().first()


async def attribute_new_registration(
    db: AsyncSession,
    *,
    invitee: models.User,
    referral_code: str | None,
) -> models.ReferralAttribution | None:
    """Привязывает нового пользователя к рефералу при регистрации.

    Код сохраняется в ``invitee.referred_by_code`` даже если атрибуция
    сейчас не создалась — при одобрении будет повторная попытка.
    """
    code = (referral_code or "").strip().upper()
    if not code:
        logger.info(
            "Реферал skip: invitee=%s reason=empty_referral_code",
            invitee.id,
        )
        return None

    invitee.referred_by_code = code
    await db.flush()

    payload = await _load_campaign(db)
    if not is_referral_campaign_accepting_new(payload):
        logger.info(
            "Реферал skip: invitee=%s code=%s reason=campaign_not_accepting "
            "enabled=%s started_at=%s ends_at=%s",
            invitee.id,
            code,
            payload.enabled,
            payload.started_at,
            payload.ends_at,
        )
        return None
    campaign_key = campaign_key_from_payload(payload)
    if not campaign_key:
        logger.info(
            "Реферал skip: invitee=%s code=%s reason=missing_campaign_key",
            invitee.id,
            code,
        )
        return None
    inviter = await get_user_by_referral_code(db, code)
    if inviter is None:
        logger.info(
            "Реферал skip: invitee=%s code=%s reason=inviter_not_found",
            invitee.id,
            code,
        )
        return None
    if inviter.id == invitee.id:
        logger.info(
            "Реферал skip: invitee=%s code=%s reason=self_referral",
            invitee.id,
            code,
        )
        return None
    if inviter.status != "approved":
        logger.info(
            "Реферал skip: invitee=%s code=%s inviter=%s reason=inviter_not_approved status=%s",
            invitee.id,
            code,
            inviter.id,
            inviter.status,
        )
        return None
    existing = await _existing_attribution(db, invitee.id, campaign_key)
    if existing is not None:
        if not existing.referral_code_used:
            existing.referral_code_used = code
        logger.info(
            "Реферал skip: invitee=%s code=%s reason=already_attributed attribution_id=%s",
            invitee.id,
            code,
            existing.id,
        )
        return existing
    row = models.ReferralAttribution(
        campaign_key=campaign_key,
        inviter_id=inviter.id,
        invitee_id=invitee.id,
        kind=KIND_NEW,
        status=STATUS_PENDING,
        attributed_at=_utcnow_naive(),
        send_days=[],
        referral_code_used=code,
    )
    db.add(row)
    await db.flush()
    logger.info(
        "Реферал new: invitee=%s inviter=%s campaign=%s code=%s",
        invitee.id,
        inviter.id,
        campaign_key,
        code,
    )
    return row


async def claim_referral_for_existing_user(
    db: AsyncSession,
    *,
    invitee: models.User,
    referral_code: str,
) -> schemas.ReferralClaimResponse:
    """Привязка по реф-коду: реактивация или поздняя привязка нового."""
    payload = await _load_campaign(db)
    if not is_referral_campaign_accepting_new(payload):
        return schemas.ReferralClaimResponse(
            ok=False,
            message="Реферальная акция сейчас неактивна.",
        )
    campaign_key = campaign_key_from_payload(payload)
    if not campaign_key:
        return schemas.ReferralClaimResponse(
            ok=False,
            message="Реферальная акция не запущена.",
        )
    code = (referral_code or "").strip().upper()
    inviter = await get_user_by_referral_code(db, code)
    if inviter is None:
        return schemas.ReferralClaimResponse(
            ok=False,
            message="Реферальная ссылка недействительна.",
        )
    if inviter.id == invitee.id:
        return schemas.ReferralClaimResponse(
            ok=False,
            message="Нельзя использовать собственную ссылку.",
        )
    if invitee.status != "approved":
        invitee.referred_by_code = code
        await db.commit()
        return schemas.ReferralClaimResponse(
            ok=True,
            message="Код сохранён. Бонус начислится после одобрения заявки.",
        )
    existing = await _existing_attribution(db, invitee.id, campaign_key)
    if existing is not None:
        if existing.status == STATUS_PENDING and existing.kind == KIND_NEW:
            await _pay_rewards(db, existing, payload, force_new=True)
            await db.commit()
            await db.refresh(existing)
            return schemas.ReferralClaimResponse(
                ok=True,
                message="Реферальный бонус начислен.",
                attribution=_attribution_to_item(existing, invitee),
            )
        return schemas.ReferralClaimResponse(
            ok=True,
            message="Вы уже участвуете в акции по этой кампании.",
            attribution=_attribution_to_item(existing, invitee),
        )

    invitee.referred_by_code = code
    if await is_user_inactive_for_referral(db, invitee, payload):
        row = models.ReferralAttribution(
            campaign_key=campaign_key,
            inviter_id=inviter.id,
            invitee_id=invitee.id,
            kind=KIND_REACTIVATION,
            status=STATUS_IN_PROGRESS,
            attributed_at=_utcnow_naive(),
            send_days=[],
            referral_code_used=code,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return schemas.ReferralClaimResponse(
            ok=True,
            message=(
                f"Отлично! Отправляйте спасибки минимум {payload.reactivation_min_days} "
                f"дня за {payload.reactivation_window_days} дней — и вы оба получите бонус."
            ),
            attribution=_attribution_to_item(row, invitee),
        )

    if await _can_late_bind_as_new(invitee, payload):
        row = models.ReferralAttribution(
            campaign_key=campaign_key,
            inviter_id=inviter.id,
            invitee_id=invitee.id,
            kind=KIND_NEW,
            status=STATUS_PENDING,
            attributed_at=_utcnow_naive(),
            send_days=[],
            referral_code_used=code,
        )
        db.add(row)
        await db.flush()
        await _pay_rewards(db, row, payload, force_new=True)
        await db.commit()
        await db.refresh(row)
        return schemas.ReferralClaimResponse(
            ok=True,
            message=(
                f"Готово! Вам начислено {payload.bonus_new_invitee} спасибок, "
                f"пригласившему — {payload.bonus_new_inviter}."
            ),
            attribution=_attribution_to_item(row, invitee),
        )

    return schemas.ReferralClaimResponse(
        ok=False,
        message=(
            f"Приглашение для вернувшихся действует, если не было активности "
            f"{payload.inactive_months} мес."
        ),
    )


async def _can_late_bind_as_new(
    invitee: models.User,
    payload: schemas.ReferralCampaignPayload,
) -> bool:
    """Можно ли поздно привязать как нового (регистрация в окне текущей акции)."""
    if not payload.started_at:
        return False
    started = _parse_iso_datetime(payload.started_at)
    reg = _as_aware_utc(invitee.registration_date)
    if started is None or reg is None:
        return False
    return reg >= started


async def ensure_reward_after_approval(
    db: AsyncSession,
    invitee: models.User,
) -> None:
    """После одобрения: добить атрибуцию по referred_by_code и начислить бонус."""
    payload = await _load_campaign(db)
    campaign_key = campaign_key_from_payload(payload)
    if campaign_key:
        existing = await _existing_attribution(db, invitee.id, campaign_key)
        if existing is not None and existing.status == STATUS_REWARDED:
            logger.info(
                "Реферал reward skip: invitee=%s reason=already_rewarded attribution_id=%s",
                invitee.id,
                existing.id,
            )
            return

    code = (invitee.referred_by_code or "").strip().upper()
    if code:
        await attribute_new_registration(db, invitee=invitee, referral_code=code)
        await db.flush()

    await reward_new_user_on_approval(db, invitee)


async def reward_new_user_on_approval(
    db: AsyncSession,
    invitee: models.User,
) -> None:
    """Начисляет бонусы за нового пользователя после одобрения заявки."""
    result = await db.execute(
        select(models.ReferralAttribution)
        .where(
            models.ReferralAttribution.invitee_id == invitee.id,
            models.ReferralAttribution.kind == KIND_NEW,
            models.ReferralAttribution.status == STATUS_PENDING,
        )
        .order_by(models.ReferralAttribution.id.desc())
        .limit(1)
    )
    row = result.scalars().first()
    if row is None:
        logger.info(
            "Реферал reward skip: invitee=%s reason=no_pending_attribution referred_by=%s",
            invitee.id,
            (invitee.referred_by_code or "")[:16] or None,
        )
        return
    payload = await _load_campaign(db)
    await _pay_rewards(db, row, payload, force_new=True)


async def track_send_for_reactivation(
    db: AsyncSession,
    sender: models.User,
) -> None:
    """Учитывает день отправки спасибки для реактивации (grace после конца акции)."""
    result = await db.execute(
        select(models.ReferralAttribution)
        .where(
            models.ReferralAttribution.invitee_id == sender.id,
            models.ReferralAttribution.kind == KIND_REACTIVATION,
            models.ReferralAttribution.status == STATUS_IN_PROGRESS,
        )
        .order_by(models.ReferralAttribution.id.desc())
        .limit(1)
    )
    row = result.scalars().first()
    if row is None:
        return
    payload = await _load_campaign(db)
    min_days = max(1, int(payload.reactivation_min_days or 3))
    window_days = max(min_days, int(payload.reactivation_window_days or 7))
    today = moscow_today().isoformat()
    days = list(row.send_days or [])
    if today not in days:
        days.append(today)
        row.send_days = days
        flag_modified(row, "send_days")
    if _has_min_days_in_window(days, min_days, window_days):
        await _pay_rewards(db, row, payload, force_new=False)


def _has_min_days_in_window(
    day_strings: list[str],
    min_days: int,
    window_days: int,
) -> bool:
    """True, если есть min_days дат в любом окне window_days."""
    parsed: list[date] = []
    for raw in day_strings:
        try:
            parsed.append(date.fromisoformat(str(raw)))
        except ValueError:
            continue
    unique = sorted(set(parsed))
    if len(unique) < min_days:
        return False
    for i, start in enumerate(unique):
        end = start + timedelta(days=window_days)
        count = sum(1 for d in unique[i:] if d < end)
        if count >= min_days:
            return True
    return False


async def _pay_rewards(
    db: AsyncSession,
    row: models.ReferralAttribution,
    payload: schemas.ReferralCampaignPayload,
    *,
    force_new: bool,
) -> None:
    """Начисляет бонусы inviter и invitee, пишет уведомления."""
    if row.status == STATUS_REWARDED:
        return
    if force_new or row.kind == KIND_NEW:
        inviter_bonus = max(0, int(payload.bonus_new_inviter))
        invitee_bonus = max(0, int(payload.bonus_new_invitee))
    else:
        inviter_bonus = max(0, int(payload.bonus_reactivate_inviter))
        invitee_bonus = max(0, int(payload.bonus_reactivate_invitee))

    inviter = await db.get(models.User, row.inviter_id)
    invitee = await db.get(models.User, row.invitee_id)
    if inviter is None or invitee is None:
        return

    if inviter_bonus:
        inviter.balance += inviter_bonus
    if invitee_bonus:
        invitee.balance += invitee_bonus

    row.status = STATUS_REWARDED
    row.rewarded_at = _utcnow_naive()
    row.inviter_bonus = inviter_bonus
    row.invitee_bonus = invitee_bonus

    import crud
    from bot import send_telegram_message, escape_html

    invitee_name = f"{invitee.first_name or ''} {invitee.last_name or ''}".strip() or "коллега"
    is_new = force_new or row.kind == KIND_NEW

    if inviter_bonus:
        if is_new:
            inviter_title = "Коллега зарегистрировался"
            inviter_message = (
                f"{invitee_name} пришёл в «Спасибо» по вашей ссылке. "
                f"Вам начислено {inviter_bonus} спасибок."
            )
            inviter_tg = (
                f"🎉 <b>Коллега зарегистрировался</b>\n\n"
                f"{escape_html(invitee_name)} пришёл в «Спасибо» по вашей ссылке.\n"
                f"Вам начислено <b>{inviter_bonus}</b> спасибок."
            )
        else:
            inviter_title = "Коллега снова в «Спасибо»"
            inviter_message = (
                f"{invitee_name} выполнил условия возвращения. "
                f"Вам начислено {inviter_bonus} спасибок."
            )
            inviter_tg = (
                f"🎉 <b>Коллега снова в «Спасибо»</b>\n\n"
                f"{escape_html(invitee_name)} выполнил условия возвращения.\n"
                f"Вам начислено <b>{inviter_bonus}</b> спасибок."
            )
        await crud._create_notification(
            db,
            inviter.id,
            "referral",
            inviter_title,
            inviter_message,
            click_url="/?panel=referral",
            push_tag=f"referral-inviter-{row.id}",
        )
        if inviter.telegram_id and inviter.telegram_id >= 0:
            try:
                await send_telegram_message(inviter.telegram_id, inviter_tg)
            except Exception as exc:
                logger.warning(
                    "Telegram реферал inviter_id=%s: %s",
                    inviter.id,
                    exc,
                )

    if invitee_bonus:
        if is_new:
            invitee_title = "Бонус за регистрацию"
            invitee_message = (
                f"Добро пожаловать в «Спасибо»! "
                f"Вам начислено {invitee_bonus} спасибок по реферальной акции."
            )
            invitee_tg = (
                f"🎁 <b>Бонус за регистрацию</b>\n\n"
                f"Добро пожаловать в «Спасибо»!\n"
                f"Вам начислено <b>{invitee_bonus}</b> спасибок по реферальной акции."
            )
        else:
            invitee_title = "Бонус за возвращение"
            invitee_message = (
                f"Условия акции выполнены. "
                f"Вам начислено {invitee_bonus} спасибок."
            )
            invitee_tg = (
                f"🎁 <b>Бонус за возвращение</b>\n\n"
                f"Условия акции выполнены.\n"
                f"Вам начислено <b>{invitee_bonus}</b> спасибок."
            )
        await crud._create_notification(
            db,
            invitee.id,
            "referral",
            invitee_title,
            invitee_message,
            click_url="/?panel=referral",
            push_tag=f"referral-invitee-{row.id}",
        )
        if invitee.telegram_id and invitee.telegram_id >= 0:
            try:
                await send_telegram_message(invitee.telegram_id, invitee_tg)
            except Exception as exc:
                logger.warning(
                    "Telegram реферал invitee_id=%s: %s",
                    invitee.id,
                    exc,
                )
    await db.flush()
    logger.info(
        "Реферал rewarded id=%s kind=%s inviter=%s(+%s) invitee=%s(+%s)",
        row.id,
        row.kind,
        inviter.id,
        inviter_bonus,
        invitee.id,
        invitee_bonus,
    )


def _attribution_to_item(
    row: models.ReferralAttribution,
    invitee: models.User | None = None,
) -> schemas.ReferralInviteItem:
    """DTO одной атрибуции для списка."""
    days = list(row.send_days or [])
    name = ""
    if invitee is not None:
        name = f"{invitee.first_name or ''} {invitee.last_name or ''}".strip()
    return schemas.ReferralInviteItem(
        id=row.id,
        invitee_id=row.invitee_id,
        invitee_name=name or f"ID {row.invitee_id}",
        kind=row.kind,
        kind_label=KIND_LABELS_RU.get(row.kind, row.kind),
        status=row.status,
        status_label=STATUS_LABELS_RU.get(row.status, row.status),
        attributed_at=row.attributed_at,
        rewarded_at=row.rewarded_at,
        send_days_count=len(set(str(d) for d in days)),
        inviter_bonus=row.inviter_bonus or 0,
        invitee_bonus=row.invitee_bonus or 0,
    )


def _public_app_base_url() -> str:
    """Публичный origin веб-приложения для шаринга."""
    from config import settings

    raw = (getattr(settings, "WEB_APP_LOGIN_URL", None) or "").strip().rstrip("/")
    return raw


def _build_share_url(code: str) -> tuple[str, str]:
    """Возвращает (share_path, абсолютный или относительный URL)."""
    share_path = f"/?ref={code}"
    base = _public_app_base_url()
    if base:
        return share_path, f"{base}{share_path}"
    return share_path, share_path


def _build_share_text(
    *,
    code: str,
    share_url: str,
    payload: schemas.ReferralCampaignPayload,
) -> str:
    """Текст приглашения с кодом и ссылкой."""
    bonus = max(0, int(payload.bonus_new_invitee))
    return (
        f"Я уже в «Спасибо», присоединяйся и ты! "
        f"Получи {bonus} приветственных спасибок за регистрацию "
        f"(или за активацию аккаунта), введи мой реферальный код {code}. "
        f"Ссылка для входа: {share_url}"
    )


async def get_my_referral_summary(
    db: AsyncSession,
    user: models.User,
) -> schemas.ReferralSummaryResponse:
    """Сводка рефералки для профиля."""
    code = await ensure_user_referral_code(db, user)
    await db.commit()
    payload = await _load_campaign(db)
    accepting = is_referral_campaign_accepting_new(payload)
    result = await db.execute(
        select(models.ReferralAttribution, models.User)
        .join(models.User, models.User.id == models.ReferralAttribution.invitee_id)
        .where(models.ReferralAttribution.inviter_id == user.id)
        .order_by(models.ReferralAttribution.attributed_at.desc())
        .limit(100)
    )
    invites = [
        _attribution_to_item(attr, invitee)
        for attr, invitee in result.all()
    ]
    earned_spasibki = sum(
        int(item.inviter_bonus or 0)
        for item in invites
        if item.status == STATUS_REWARDED
    )
    registered_count = sum(1 for item in invites if item.kind == KIND_NEW)
    share_path, share_url = _build_share_url(code)
    return schemas.ReferralSummaryResponse(
        code=code,
        share_path=share_path,
        share_text=_build_share_text(code=code, share_url=share_url, payload=payload),
        campaign_active=accepting,
        campaign=payload,
        invites=invites,
        rules=_build_rules_text(payload),
        earned_spasibki=earned_spasibki,
        registered_count=registered_count,
        invitees_count=len(invites),
    )


def _build_rules_text(payload: schemas.ReferralCampaignPayload) -> str:
    """Краткие правила акции для UI."""
    return (
        f"1. Поделитесь персональной ссылкой с коллегой.\n"
        f"2. Новый пользователь: после регистрации и входа в «Спасибо» "
        f"вы получаете по {payload.bonus_new_inviter} спасибок, "
        f"а приглашённый — {payload.bonus_new_invitee}.\n"
        f"3. Коллега без активности {payload.inactive_months} мес.: "
        f"нужно отправить спасибки минимум в {payload.reactivation_min_days} "
        f"разных дня за {payload.reactivation_window_days} дней. "
        f"После этого вы оба получите бонус "
        f"({payload.bonus_reactivate_inviter} / {payload.bonus_reactivate_invitee}).\n"
        f"4. Акция длится месяц. Если коллега начал выполнять условия до конца акции, "
        f"прогресс сохраняется. Новые приглашения после окончания не принимаются."
    )


def _user_display_name(user: models.User | None, fallback_id: int) -> str:
    """ФИО пользователя или запасной идентификатор."""
    if user is None:
        return f"ID {fallback_id}"
    name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return name or f"ID {fallback_id}"


async def get_admin_referral_stats(
    db: AsyncSession,
) -> schemas.ReferralAdminStatsResponse:
    """Полная статистика рефералок для админ-панели."""
    inviter_u = aliased(models.User)
    invitee_u = aliased(models.User)
    result = await db.execute(
        select(models.ReferralAttribution, inviter_u, invitee_u)
        .join(inviter_u, inviter_u.id == models.ReferralAttribution.inviter_id)
        .join(invitee_u, invitee_u.id == models.ReferralAttribution.invitee_id)
        .order_by(models.ReferralAttribution.attributed_at.desc())
        .limit(2000)
    )
    attributions: list[schemas.ReferralAdminAttributionItem] = []
    rewarded_count = 0
    pending_count = 0
    in_progress_count = 0
    new_count = 0
    reactivation_count = 0
    total_inviter_bonuses = 0
    total_invitee_bonuses = 0
    attributed_invitee_ids: set[int] = set()

    for attr, inviter, invitee in result.all():
        attributed_invitee_ids.add(attr.invitee_id)
        days = list(attr.send_days or [])
        item = schemas.ReferralAdminAttributionItem(
            id=attr.id,
            campaign_key=attr.campaign_key,
            inviter_id=attr.inviter_id,
            inviter_name=_user_display_name(inviter, attr.inviter_id),
            inviter_code=inviter.referral_code,
            invitee_id=attr.invitee_id,
            invitee_name=_user_display_name(invitee, attr.invitee_id),
            invitee_status=invitee.status or "",
            referred_by_code=invitee.referred_by_code,
            referral_code_used=attr.referral_code_used,
            kind=attr.kind,
            kind_label=KIND_LABELS_RU.get(attr.kind, attr.kind),
            status=attr.status,
            status_label=STATUS_LABELS_RU.get(attr.status, attr.status),
            attributed_at=attr.attributed_at,
            rewarded_at=attr.rewarded_at,
            inviter_bonus=attr.inviter_bonus or 0,
            invitee_bonus=attr.invitee_bonus or 0,
            send_days_count=len(set(str(d) for d in days)),
        )
        attributions.append(item)
        if attr.status == STATUS_REWARDED:
            rewarded_count += 1
            total_inviter_bonuses += int(attr.inviter_bonus or 0)
            total_invitee_bonuses += int(attr.invitee_bonus or 0)
        elif attr.status == STATUS_PENDING:
            pending_count += 1
        elif attr.status == STATUS_IN_PROGRESS:
            in_progress_count += 1
        if attr.kind == KIND_NEW:
            new_count += 1
        elif attr.kind == KIND_REACTIVATION:
            reactivation_count += 1

    orphan_rows = await db.execute(
        select(models.User)
        .where(
            models.User.referred_by_code.is_not(None),
            models.User.referred_by_code != "",
        )
        .order_by(models.User.registration_date.desc())
        .limit(500)
    )
    orphans: list[schemas.ReferralAdminOrphanItem] = []
    for user in orphan_rows.scalars().all():
        if user.id in attributed_invitee_ids:
            continue
        code = (user.referred_by_code or "").strip()
        if not code:
            continue
        orphans.append(
            schemas.ReferralAdminOrphanItem(
                user_id=user.id,
                user_name=_user_display_name(user, user.id),
                user_status=user.status or "",
                referred_by_code=code,
                registration_date=user.registration_date,
            )
        )

    return schemas.ReferralAdminStatsResponse(
        total_attributions=len(attributions),
        rewarded_count=rewarded_count,
        pending_count=pending_count,
        in_progress_count=in_progress_count,
        new_count=new_count,
        reactivation_count=reactivation_count,
        total_inviter_bonuses=total_inviter_bonuses,
        total_invitee_bonuses=total_invitee_bonuses,
        orphan_count=len(orphans),
        attributions=attributions,
        orphans=orphans,
    )


def _as_naive_utc(value: datetime | None) -> datetime | None:
    """Naive UTC для сравнения snooze."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def promo_state_to_response(
    row: models.ReferralPromoUserState | None,
) -> schemas.ReferralPromoUserStateResponse:
    """DTO состояния рекламы рефералки."""
    now = _utcnow_naive()
    if row is None:
        return schemas.ReferralPromoUserStateResponse(
            is_done=False,
            done_reason=None,
            snoozed_until=None,
            is_snoozed=False,
            can_show=True,
        )
    snoozed_until = _as_naive_utc(row.snoozed_until)
    is_done = row.done_at is not None
    is_snoozed = snoozed_until is not None and snoozed_until > now
    return schemas.ReferralPromoUserStateResponse(
        is_done=is_done,
        done_reason=row.done_reason,
        snoozed_until=snoozed_until,
        is_snoozed=is_snoozed and not is_done,
        can_show=(not is_done) and (not is_snoozed),
    )


async def get_promo_state(
    db: AsyncSession,
    user_id: int,
) -> schemas.ReferralPromoUserStateResponse:
    """Состояние показа рекламы рефералки."""
    row = await db.get(models.ReferralPromoUserState, user_id)
    return promo_state_to_response(row)


async def snooze_promo(
    db: AsyncSession,
    user_id: int,
    *,
    days: int = REFERRAL_PROMO_SNOOZE_DAYS,
) -> schemas.ReferralPromoUserStateResponse:
    """Откладывает рекламу рефералки."""
    now = _utcnow_naive()
    until = now + timedelta(days=max(1, days))
    row = await _get_or_create_promo_row(db, user_id)
    if row.done_at is not None:
        return promo_state_to_response(row)
    current = _as_naive_utc(row.snoozed_until)
    if current is None or current < until:
        row.snoozed_until = until
    row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return promo_state_to_response(row)


async def mark_promo_done(
    db: AsyncSession,
    user_id: int,
    *,
    reason: str = "done",
) -> schemas.ReferralPromoUserStateResponse:
    """Помечает, что пользователь открыл рефералку / закрыл промо."""
    now = _utcnow_naive()
    row = await _get_or_create_promo_row(db, user_id)
    if row.done_at is None:
        row.done_at = now
        row.done_reason = (reason or "done")[:64]
    row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return promo_state_to_response(row)


async def _get_or_create_promo_row(
    db: AsyncSession,
    user_id: int,
) -> models.ReferralPromoUserState:
    """Строка состояния рекламы рефералки."""
    row = await db.get(models.ReferralPromoUserState, user_id)
    if row is not None:
        return row
    row = models.ReferralPromoUserState(user_id=user_id)
    db.add(row)
    await db.flush()
    return row
