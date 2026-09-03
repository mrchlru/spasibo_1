"""Призовые картинки автовыдачи: загрузка JPEG в S3 и переименование папки товара."""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import models
from image_prize_jpeg import encode_prize_image_bytes_to_jpeg
from object_storage import (
    build_public_url,
    generate_prize_object_key,
    is_object_storage_configured,
    is_prize_asset_url,
    prize_folder_prefix,
    rename_object_prefix,
    slugify_prize_folder,
    upload_bytes,
)

logger = logging.getLogger(__name__)


async def upload_prize_image_bytes(
    raw: bytes,
    *,
    product_name: str,
    original_filename: str | None = None,
) -> tuple[str, str]:
    """Сжимает картинку в JPEG, кладёт в папку товара и возвращает (url, key)."""
    if not is_object_storage_configured():
        raise RuntimeError("Объектное хранилище не настроено")

    folder_slug = slugify_prize_folder(product_name)
    jpeg_bytes = await asyncio.to_thread(encode_prize_image_bytes_to_jpeg, raw)
    key = generate_prize_object_key(folder_slug)
    from pathlib import Path

    stem = Path(original_filename or "prize").stem.strip() or "prize"
    safe_name = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in stem)[:64]
    disposition = f'inline; filename="{safe_name}.jpg"'
    url = await asyncio.to_thread(
        lambda: upload_bytes(
            key,
            jpeg_bytes,
            "image/jpeg",
            content_disposition=disposition,
        )
    )
    return url, key


async def sync_prize_folder_after_rename(
    db: AsyncSession,
    item: models.MarketItem,
    new_name: str,
    *,
    previous_name: str | None = None,
) -> None:
    """Переименовывает папку призов в S3 и обновляет URL кодов товара."""
    new_slug = slugify_prize_folder(new_name)
    old_slug = (item.prize_folder_slug or "").strip()
    if not old_slug and previous_name:
        old_slug = slugify_prize_folder(previous_name)
    if not old_slug or old_slug == new_slug:
        item.prize_folder_slug = new_slug
        return

    if not is_object_storage_configured():
        item.prize_folder_slug = new_slug
        return

    old_prefix = prize_folder_prefix(old_slug)
    new_prefix = prize_folder_prefix(new_slug)
    try:
        mapping = await asyncio.to_thread(rename_object_prefix, old_prefix, new_prefix)
    except Exception:
        logger.exception(
            "Не удалось переименовать папку призов %s -> %s",
            old_slug,
            new_slug,
        )
        item.prize_folder_slug = new_slug
        return

    if not mapping:
        item.prize_folder_slug = new_slug
        return

    result = await db.execute(
        select(models.ItemCode).where(models.ItemCode.market_item_id == item.id)
    )
    codes = list(result.scalars().all())
    for code in codes:
        if not is_prize_asset_url(code.code_value):
            continue
        for old_key, new_key in mapping.items():
            old_url = build_public_url(old_key)
            if code.code_value == old_url or code.code_value.endswith(old_key):
                code.code_value = build_public_url(new_key)
                break
            if old_key in code.code_value:
                code.code_value = code.code_value.replace(old_key, new_key, 1)
                break

    item.prize_folder_slug = new_slug
