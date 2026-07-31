"""Админ-загрузка изображений в объектное хранилище с конвертацией в AVIF."""

import asyncio
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

import schemas
from config import settings
from dependencies import get_current_admin_user
from image_avif import encode_image_bytes_to_avif
from models import User
from object_storage import (
    generate_media_object_key,
    is_object_storage_configured,
    upload_bytes,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _content_type_allowed(content_type: str) -> bool:
    """Проверяет MIME до чтения файла (часть клиентов шлёт пустой тип или octet-stream)."""
    if not content_type:
        return True
    if content_type.startswith("image/"):
        return True
    if content_type in ("image/svg+xml", "application/svg+xml"):
        return True
    if content_type == "application/octet-stream":
        return True
    return False


async def store_uploaded_image_file(
    file: UploadFile,
    *,
    key_prefix: str = "media",
) -> str:
    """Читает UploadFile, конвертирует в AVIF и возвращает публичный URL."""
    if not is_object_storage_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Загрузка изображений временно недоступна. Обратитесь к администратору.",
        )
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if not _content_type_allowed(content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Неподдерживаемый тип файла: {content_type or '(пусто)'}",
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Файл пустой",
        )
    try:
        avif_bytes = await asyncio.to_thread(
            encode_image_bytes_to_avif,
            raw,
            max_side=settings.IMAGE_MAX_SIDE_PX,
            quality=settings.IMAGE_AVIF_QUALITY,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    key = generate_media_object_key(prefix=key_prefix)
    try:
        return await asyncio.to_thread(upload_bytes, key, avif_bytes, "image/avif")
    except RuntimeError as exc:
        logger.exception("S3 upload failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


@router.get("/admin/media/status", response_model=schemas.AdminMediaStatusResponse)
async def get_media_upload_status(
    _admin: User = Depends(get_current_admin_user),
) -> schemas.AdminMediaStatusResponse:
    """Проверка, настроено ли объектное хранилище для загрузки из админки."""
    return schemas.AdminMediaStatusResponse(enabled=is_object_storage_configured())


@router.post("/admin/media/upload", response_model=schemas.AdminMediaUploadResponse)
async def upload_admin_image(
    _admin: User = Depends(get_current_admin_user),
    file: UploadFile = File(...),
    prefix: str = Query(default="media", min_length=1, max_length=64),
) -> schemas.AdminMediaUploadResponse:
    """Принимает изображение, конвертирует в AVIF и загружает в S3 (Timeweb / совместимое API)."""
    safe_prefix = prefix.strip().strip("/") or "media"
    url = await store_uploaded_image_file(file, key_prefix=safe_prefix)
    return schemas.AdminMediaUploadResponse(url=url, content_type="image/avif")
