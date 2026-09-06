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
    st = row.season_theme if row.season_theme in ("summer", "winter") else "summer"
    return schemas.AppSettingsResponse(
        id=row.id,
        season_theme=st,
        theme_assets=theme_assets,
        android_release=android_release,
    )


async def get_app_settings(db: AsyncSession):
    result = await db.execute(
        select(models.AppSettings).order_by(models.AppSettings.id.asc()).limit(1)
    )
    settings_row = result.scalars().first()
    if settings_row:
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
        else:
            setattr(settings_row, key, value)

    await db.commit()
    await db.refresh(settings_row)
    return settings_row
