from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import models
import schemas


def app_settings_to_response(row: models.AppSettings) -> schemas.AppSettingsResponse:
    """Преобразует строку БД в ответ API с вложенными JSON-полями."""
    theme_assets = None
    if row.theme_assets is not None:
        theme_assets = schemas.ThemeAssetsPayload.model_validate(row.theme_assets)
    android_release = None
    if row.android_release is not None:
        android_release = schemas.AndroidReleasePayload.model_validate(row.android_release)
    install_promo = None
    if row.install_promo is not None:
        install_promo = schemas.InstallPromoPayload.model_validate(row.install_promo)
    referral = None
    if row.referral is not None:
        referral = schemas.ReferralCampaignPayload.model_validate(row.referral)
    st = row.season_theme if row.season_theme in ("summer", "winter") else "summer"
    return schemas.AppSettingsResponse(
        id=row.id,
        season_theme=st,
        theme_assets=theme_assets,
        android_release=android_release,
        install_promo=install_promo,
        referral=referral,
    )


async def get_app_settings(db: AsyncSession):
    result = await db.execute(
        select(models.AppSettings).order_by(models.AppSettings.id.asc()).limit(1)
    )
    settings_row = result.scalars().first()
    if settings_row:
        await _expire_install_promo_if_needed(db, settings_row)
        await _expire_referral_if_needed(db, settings_row)
        return settings_row

    settings_row = models.AppSettings(season_theme="summer")
    db.add(settings_row)
    await db.commit()
    await db.refresh(settings_row)
    return settings_row


async def update_app_settings(db: AsyncSession, settings_data: schemas.AppSettingsUpdate):
    settings_row = await get_app_settings(db)
    update_data = settings_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key == "theme_assets":
            if value is None:
                setattr(settings_row, "theme_assets", None)
            else:
                payload = schemas.ThemeAssetsPayload.model_validate(value)
                dumped = payload.model_dump(exclude_none=True)
                setattr(settings_row, "theme_assets", dumped if dumped else None)
        elif key == "android_release":
            if value is None:
                setattr(settings_row, "android_release", None)
            else:
                payload = schemas.AndroidReleasePayload.model_validate(value)
                dumped = payload.model_dump(exclude_none=True)
                setattr(settings_row, "android_release", dumped if dumped else None)
        elif key == "install_promo":
            if value is None:
                setattr(settings_row, "install_promo", None)
            else:
                payload = schemas.InstallPromoPayload.model_validate(value)
                dumped = payload.model_dump()
                setattr(settings_row, "install_promo", dumped)
        elif key == "referral":
            if value is None:
                setattr(settings_row, "referral", None)
            else:
                payload = schemas.ReferralCampaignPayload.model_validate(value)
                dumped = payload.model_dump()
                setattr(settings_row, "referral", dumped)
        else:
            setattr(settings_row, key, value)

    await db.commit()
    await db.refresh(settings_row)
    return settings_row


async def _expire_install_promo_if_needed(
    db: AsyncSession,
    settings_row: models.AppSettings,
) -> None:
    """Автоматически выключает кампанию после ends_at."""
    raw = settings_row.install_promo
    if not isinstance(raw, dict) or not raw.get("enabled"):
        return
    ends_raw = raw.get("ends_at")
    if not ends_raw:
        return
    ends_at = _parse_iso_datetime(str(ends_raw))
    if ends_at is None or ends_at > datetime.now(timezone.utc):
        return
    next_promo = dict(raw)
    next_promo["enabled"] = False
    settings_row.install_promo = next_promo
    await db.commit()
    await db.refresh(settings_row)


async def _expire_referral_if_needed(
    db: AsyncSession,
    settings_row: models.AppSettings,
) -> None:
    """Автоматически выключает реферальную кампанию после ends_at."""
    raw = settings_row.referral
    if not isinstance(raw, dict) or not raw.get("enabled"):
        return
    ends_raw = raw.get("ends_at")
    if not ends_raw:
        return
    ends_at = _parse_iso_datetime(str(ends_raw))
    if ends_at is None or ends_at > datetime.now(timezone.utc):
        return
    next_referral = dict(raw)
    next_referral["enabled"] = False
    settings_row.referral = next_referral
    await db.commit()
    await db.refresh(settings_row)


def _parse_iso_datetime(value: str) -> datetime | None:
    """Парсит ISO-дату; naive значения считаются UTC."""
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
