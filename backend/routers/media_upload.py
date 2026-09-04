"""Админ-загрузка изображений в объектное хранилище с конвертацией в AVIF."""

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

import schemas
from config import settings
from database import get_db
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

MAX_DOCUMENT_BYTES = 15 * 1024 * 1024

_ALLOWED_DOCUMENT_EXTENSIONS: dict[str, str] = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def _content_type_allowed(content_type: str) -> bool:
    """Проверяет MIME до чтения файла (часть клиентов шлёт пустой тип или octet-stream)."""
    if not content_type:
        return True
    if content_type.startswith("image/"):
        return True
    if content_type == "application/octet-stream":
        return True
    return False


def _resolve_document_content_type(filename: str, content_type: str) -> str:
    """Определяет MIME документа по расширению или заголовку."""
    extension = Path(filename or "").suffix.lower()
    if extension in _ALLOWED_DOCUMENT_EXTENSIONS:
        return _ALLOWED_DOCUMENT_EXTENSIONS[extension]

    normalized = (content_type or "").split(";")[0].strip().lower()
    allowed_types = set(_ALLOWED_DOCUMENT_EXTENSIONS.values())
    if normalized in allowed_types:
        return normalized

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Поддерживаются PDF, Word, Excel и PowerPoint",
    )


async def store_uploaded_image_file(
    db: AsyncSession,
    file: UploadFile,
    *,
    key_prefix: str = "media",
    max_side: int | None = None,
    quality: int | None = None,
) -> str:
    """Читает UploadFile, конвертирует в AVIF, сохраняет и возвращает публичный URL."""
    if not is_object_storage_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Объектное хранилище не настроено (S3_BUCKET, ключи доступа).",
        )
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if not _content_type_allowed(content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Неподдерживаемый тип файла: {content_type or '(пусто)'}",
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Файл пустой")
    try:
        avif_bytes = await asyncio.to_thread(
            encode_image_bytes_to_avif,
            raw,
            max_side=max_side or settings.IMAGE_MAX_SIDE_PX,
            quality=quality or settings.IMAGE_AVIF_QUALITY,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    key = generate_media_object_key(prefix=key_prefix, extension="avif")
    try:
        return await asyncio.to_thread(upload_bytes, key, avif_bytes, "image/avif")
    except RuntimeError as exc:
        logger.exception("S3 upload failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


async def store_uploaded_document_file(
    db: AsyncSession,
    file: UploadFile,
    *,
    key_prefix: str = "feed-posts/documents",
) -> schemas.AdminDocumentUploadResponse:
    """Загружает документ и возвращает публичный URL."""
    if not is_object_storage_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Объектное хранилище не настроено (S3_BUCKET, ключи доступа).",
        )
    filename = Path(file.filename or "document").name.strip() or "document"
    content_type = _resolve_document_content_type(filename, file.content_type or "")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Файл пустой")
    if len(raw) > MAX_DOCUMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Файл слишком большой (максимум 15 МБ)",
        )

    extension = Path(filename).suffix.lower() or ".bin"
    key = generate_media_object_key(prefix=key_prefix, extension=extension.lstrip("."))
    try:
        url = await asyncio.to_thread(upload_bytes, key, raw, content_type)
    except RuntimeError as exc:
        logger.exception("S3 document upload failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return schemas.AdminDocumentUploadResponse(
        url=url,
        filename=filename,
        content_type=content_type,
    )


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
    db: AsyncSession = Depends(get_db),
) -> schemas.AdminMediaUploadResponse:
    """Принимает изображение, конвертирует в AVIF и загружает в S3 (Timeweb / совместимое API)."""
    url = await store_uploaded_image_file(db, file, key_prefix="media")
    return schemas.AdminMediaUploadResponse(url=url, content_type="image/avif")


@router.post("/admin/media/upload-prize-image", response_model=schemas.AdminPrizeImageUploadResponse)
async def upload_admin_prize_image(
    _admin: User = Depends(get_current_admin_user),
    file: UploadFile = File(...),
    product_name: str = Query(..., min_length=1, max_length=255),
) -> schemas.AdminPrizeImageUploadResponse:
    """Загружает призовую картинку автовыдачи: JPEG (без AVIF) в папку товара."""
    from market_prize_asset_service import upload_prize_image_bytes
    from object_storage import slugify_prize_folder

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if not _content_type_allowed(content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Неподдерживаемый тип файла: {content_type or '(пусто)'}",
        )
    if not is_object_storage_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Объектное хранилище не настроено",
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Файл пустой")
    try:
        url, key = await upload_prize_image_bytes(
            raw,
            product_name=product_name,
            original_filename=file.filename,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return schemas.AdminPrizeImageUploadResponse(
        url=url,
        content_type="image/jpeg",
        folder_slug=slugify_prize_folder(product_name),
        object_key=key,
    )
