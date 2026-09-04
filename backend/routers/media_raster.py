"""WebP-fallback для клиентов без AVIF (Android WebView)."""

import asyncio
import logging
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response

import pillow_avif  # noqa: F401 — декодирование AVIF в Pillow
from config import settings
from image_webp import encode_image_bytes_to_webp
from object_storage import public_url_to_object_key

logger = logging.getLogger(__name__)

router = APIRouter()

_ALLOWED_HOST_SUFFIXES = (
    "twcstorage.ru",
    "postimg.cc",
    "twc1.net",
)


def _is_allowed_media_url(url: str) -> bool:
    """Проверяет, что URL ведёт на разрешённый CDN или статику приложения."""
    normalized = (url or "").strip()
    if not normalized:
        return False

    parsed = urlparse(normalized)
    if parsed.scheme not in ("http", "https"):
        return False

    host = (parsed.hostname or "").lower()
    if any(host == suffix or host.endswith(f".{suffix}") for suffix in _ALLOWED_HOST_SUFFIXES):
        return True

    if parsed.path.endswith(".avif") and public_url_to_object_key(normalized):
        return True

    public_base = settings.S3_PUBLIC_BASE_URL.strip().rstrip("/").lower()
    if public_base and normalized.lower().startswith(public_base + "/"):
        return True

    endpoint = settings.S3_ENDPOINT_URL.strip().rstrip("/").lower()
    bucket = settings.S3_BUCKET.strip().lower()
    if endpoint and bucket:
        prefix = f"{endpoint}/{bucket}/"
        if normalized.lower().startswith(prefix):
            return True

    return False


async def _fetch_bytes(url: str) -> bytes:
    """Скачивает изображение по публичному URL."""
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        response = await client.get(url)
    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Не удалось загрузить изображение ({response.status_code})",
        )
    body = response.content
    if not body:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Пустой ответ CDN")
    return body


@router.get("/media/raster")
async def media_raster_fallback(
    src: str = Query(..., min_length=8, description="Публичный URL AVIF/WebP/PNG"),
) -> Response:
    """Конвертирует AVIF (и другие форматы) в WebP для старых WebView."""
    if not _is_allowed_media_url(src):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL не разрешён")

    try:
        raw = await _fetch_bytes(src)
        webp_bytes = await asyncio.to_thread(
            encode_image_bytes_to_webp,
            raw,
            max_side=settings.IMAGE_MAX_SIDE_PX,
            quality=min(settings.IMAGE_AVIF_QUALITY + 5, 90),
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("media/raster failed for %s", src)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не удалось сконвертировать изображение",
        ) from exc

    return Response(
        content=webp_bytes,
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=86400"},
    )
