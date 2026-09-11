"""Конвертация AVIF→WebP с ограничением параллелизма, кешем и S3 API."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from typing import Callable

import httpx
from fastapi import HTTPException, status

from config import settings
from image_webp import encode_image_bytes_to_webp
from object_storage import download_object_bytes, is_object_storage_configured, public_url_to_object_key

logger = logging.getLogger(__name__)

_RETRY_DELAYS_SEC = (0.25, 0.6, 1.2, 2.5)
_SLOWDOWN_CODES = {429, 503, 502, 504}


class _RasterCache:
    """Простой LRU-кеш WebP-байтов в памяти процесса."""

    def __init__(self, max_entries: int, ttl_seconds: int) -> None:
        self._max_entries = max(32, max_entries)
        self._ttl_seconds = max(60, ttl_seconds)
        self._items: OrderedDict[str, tuple[float, bytes]] = OrderedDict()

    def get(self, key: str) -> bytes | None:
        entry = self._items.get(key)
        if entry is None:
            return None
        stored_at, payload = entry
        if time.monotonic() - stored_at > self._ttl_seconds:
            self._items.pop(key, None)
            return None
        self._items.move_to_end(key)
        return payload

    def set(self, key: str, payload: bytes) -> None:
        if not payload:
            return
        self._items[key] = (time.monotonic(), payload)
        self._items.move_to_end(key)
        while len(self._items) > self._max_entries:
            self._items.popitem(last=False)


_raster_cache = _RasterCache(
    max_entries=settings.MEDIA_RASTER_CACHE_MAX_ENTRIES,
    ttl_seconds=settings.MEDIA_RASTER_CACHE_TTL_SECONDS,
)
_raster_semaphore = asyncio.Semaphore(max(1, settings.MEDIA_RASTER_MAX_CONCURRENT))
_inflight_raster: dict[str, asyncio.Task[bytes]] = {}


def _is_slowdown_error(exc: Exception) -> bool:
    """True, если ошибка похожа на rate limit S3/CDN."""
    text = str(exc).lower()
    return (
        "slowdown" in text
        or "slow down" in text
        or "too many requests" in text
        or "502" in text
        or "503" in text
        or "504" in text
    )


async def _run_with_retries(operation: Callable[[], bytes]) -> bytes:
    """Выполняет sync-операцию в thread pool с backoff при SlowDown."""
    last_error: Exception | None = None
    for attempt, delay in enumerate(_RETRY_DELAYS_SEC):
        try:
            return await asyncio.to_thread(operation)
        except Exception as exc:
            last_error = exc
            if not _is_slowdown_error(exc) or attempt >= len(_RETRY_DELAYS_SEC) - 1:
                raise
            await asyncio.sleep(delay)
    if last_error:
        raise last_error
    raise RuntimeError("Не удалось выполнить операцию S3")


async def _fetch_http_bytes(url: str) -> bytes:
    """Скачивает байты по HTTP с retry при 429/503."""
    last_error: Exception | None = None
    timeout = httpx.Timeout(30.0, connect=10.0, read=25.0)

    for attempt, delay in enumerate(_RETRY_DELAYS_SEC):
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                response = await client.get(url)
            if response.status_code in _SLOWDOWN_CODES and attempt < len(_RETRY_DELAYS_SEC) - 1:
                await asyncio.sleep(delay)
                continue
            if response.status_code >= 400:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Не удалось загрузить изображение ({response.status_code})",
                )
            body = response.content
            if not body:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Пустой ответ CDN",
                )
            return body
        except HTTPException:
            raise
        except Exception as exc:
            last_error = exc
            if attempt >= len(_RETRY_DELAYS_SEC) - 1:
                break
            await asyncio.sleep(delay)

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Не удалось загрузить изображение: {last_error}",
    ) from last_error


async def fetch_source_bytes(url: str) -> bytes:
    """Загружает исходник: для S3 — через API, иначе HTTP."""
    object_key = public_url_to_object_key(url)
    if object_key and is_object_storage_configured():
        return await _run_with_retries(lambda: download_object_bytes(object_key))
    return await _fetch_http_bytes(url)


async def rasterize_url_to_webp(normalized_src: str) -> bytes:
    """Возвращает WebP для URL с кешем и singleflight."""
    cached = _raster_cache.get(normalized_src)
    if cached is not None:
        return cached

    inflight = _inflight_raster.get(normalized_src)
    if inflight is not None:
        return await inflight

    async def _convert() -> bytes:
        async with _raster_semaphore:
            raw = await fetch_source_bytes(normalized_src)
            return await asyncio.to_thread(
                encode_image_bytes_to_webp,
                raw,
                max_side=settings.IMAGE_MAX_SIDE_PX,
                quality=min(settings.IMAGE_AVIF_QUALITY + 5, 90),
            )

    task = asyncio.create_task(_convert())
    _inflight_raster[normalized_src] = task
    try:
        webp_bytes = await task
        _raster_cache.set(normalized_src, webp_bytes)
        return webp_bytes
    finally:
        _inflight_raster.pop(normalized_src, None)
