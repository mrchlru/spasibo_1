"""Загрузка и отдача аватаров пользователей."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import bot
import models
from config import settings
from image_webp import encode_image_bytes_to_webp
from object_storage import (
    delete_object_key,
    generate_avatar_object_key,
    is_object_storage_configured,
    upload_bytes,
)

logger = logging.getLogger(__name__)


def build_avatar_public_path(user_id: int) -> str:
    """Относительный URL аватара в API."""
    return f"/users/{user_id}/avatar"


def resolve_public_avatar_url(user: models.User | None) -> str | None:
    """Возвращает URL аватара для клиента."""
    if user is None:
        return None
    if user.avatar_storage_key or user.avatar_webp:
        return build_avatar_public_path(user.id)
    url = (user.telegram_photo_url or "").strip()
    if not url:
        return None
    if url.startswith("/users/"):
        return url
    return url


def user_has_local_avatar(user: models.User) -> bool:
    """True, если аватар сохранён локально (S3 или BLOB)."""
    return bool(user.avatar_storage_key or user.avatar_webp)


async def save_avatar_bytes_for_user(db: AsyncSession, user: models.User, raw: bytes) -> None:
    """Конвертирует и сохраняет аватар пользователя."""
    webp_bytes = await asyncio.to_thread(
        encode_image_bytes_to_webp,
        raw,
        max_side=settings.AVATAR_MAX_SIDE_PX,
        quality=settings.AVATAR_WEBP_QUALITY,
    )
    old_key = user.avatar_storage_key
    now = datetime.utcnow()

    if is_object_storage_configured():
        key = generate_avatar_object_key(user.id)
        await asyncio.to_thread(upload_bytes, key, webp_bytes, "image/webp")
        user.avatar_storage_key = key
        user.avatar_webp = None
        user.telegram_photo_url = build_avatar_public_path(user.id)
        if old_key and old_key != key:
            delete_object_key(old_key)
    else:
        user.avatar_webp = webp_bytes
        user.avatar_storage_key = None
        user.telegram_photo_url = build_avatar_public_path(user.id)

    user.avatar_updated_at = now


async def download_and_store_user_avatar(db: AsyncSession, user: models.User) -> bool:
    """Скачивает Telegram-фото и сохраняет локально."""
    source_url = (user.telegram_photo_url or "").strip()
    if not source_url or source_url.startswith("/users/"):
        if user.telegram_id and user.telegram_id > 0:
            file_path = await bot.get_telegram_user_profile_photo_path(user.telegram_id)
            if file_path:
                try:
                    content = await bot.download_telegram_file(file_path)
                    if content:
                        await save_avatar_bytes_for_user(db, user, content)
                        return True
                except Exception as exc:
                    logger.warning(
                        "Не удалось скачать аватар через Bot API user_id=%s: %s",
                        user.id,
                        exc,
                    )
            return False
        return False

    try:
        content, _ = await bot.fetch_telegram_photo_url(source_url)
    except Exception as exc:
        logger.warning("Не удалось скачать аватар user_id=%s: %s", user.id, exc)
        return False

    if not content:
        return False

    await save_avatar_bytes_for_user(db, user, content)
    return True


async def refresh_user_avatar_if_stale(db: AsyncSession, user: models.User) -> bool:
    """Обновляет аватар, если прошло больше AVATAR_REFRESH_DAYS дней."""
    if user.telegram_id is None or user.telegram_id < 0:
        return False

    cutoff = datetime.utcnow() - timedelta(days=settings.AVATAR_REFRESH_DAYS)
    if user.avatar_updated_at and user.avatar_updated_at > cutoff and user_has_local_avatar(user):
        return False

    old_key = user.avatar_storage_key
    updated = await download_and_store_user_avatar(db, user)
    if updated and old_key and old_key != user.avatar_storage_key:
        delete_object_key(old_key)
    return updated


async def refresh_all_user_avatars(db: AsyncSession) -> int:
    """Обновляет аватары пользователей, которым нужно обновление (старше 30 дней или без локальной копии)."""
    result = await db.execute(
        select(models.User).where(
            models.User.telegram_id.isnot(None),
            models.User.telegram_id >= 0,
            models.User.status == "approved",
        )
    )
    users = list(result.scalars().all())
    updated_count = 0

    for user in users:
        try:
            if await refresh_user_avatar_if_stale(db, user):
                updated_count += 1
        except Exception as exc:
            logger.warning("Ошибка обновления аватара user_id=%s: %s", user.id, exc)

    await db.commit()
    logger.info("Обновлено аватаров: %s из %s", updated_count, len(users))
    return updated_count


def read_avatar_bytes(user: models.User) -> tuple[bytes, str] | None:
    """Возвращает байты аватара из BLOB или None."""
    if user.avatar_webp:
        return user.avatar_webp, "image/webp"
    return None


async def read_avatar_from_storage(user: models.User) -> tuple[bytes, str] | None:
    """Скачивает аватар из S3 по ключу."""
    key = (user.avatar_storage_key or "").strip()
    if not key or not is_object_storage_configured():
        return None

    import boto3
    from botocore.exceptions import ClientError

    session = boto3.session.Session()
    client = session.client(
        service_name="s3",
        endpoint_url=settings.S3_ENDPOINT_URL.strip(),
        aws_access_key_id=settings.S3_ACCESS_KEY_ID.strip(),
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY.strip(),
        region_name=settings.S3_REGION.strip() or "ru-1",
    )
    try:
        response = client.get_object(Bucket=settings.S3_BUCKET.strip(), Key=key)
        body = response["Body"].read()
        content_type = response.get("ContentType") or "image/webp"
        return body, content_type
    except ClientError as exc:
        logger.warning("Не удалось прочитать аватар user_id=%s: %s", user.id, exc)
        return None
