"""Короткий in-memory кеш ответов Teams Bonus (снижает нагрузку на API)."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

T = TypeVar("T")

_PARTNERS_CACHE: tuple[float, Any] | None = None
_PARTNERS_TTL_SECONDS = 3600

_HISTORY_CACHE: dict[str, tuple[float, Any]] = {}
_HISTORY_TTL_SECONDS = 45
_HISTORY_MAX_ENTRIES = 200


async def cached_partners(fetch: Callable[[], Awaitable[T]]) -> T:
    """Кеширует каталог партнёров на час."""
    global _PARTNERS_CACHE
    now = time.monotonic()
    if _PARTNERS_CACHE is not None:
        expires_at, payload = _PARTNERS_CACHE
        if now < expires_at:
            return payload
    payload = await fetch()
    _PARTNERS_CACHE = (now + _PARTNERS_TTL_SECONDS, payload)
    return payload


async def cached_history(key: str, fetch: Callable[[], Awaitable[T]]) -> T:
    """Кеширует порцию истории на ~45 с."""
    now = time.monotonic()
    cached = _HISTORY_CACHE.get(key)
    if cached is not None:
        expires_at, payload = cached
        if now < expires_at:
            return payload
    payload = await fetch()
    if len(_HISTORY_CACHE) >= _HISTORY_MAX_ENTRIES:
        _HISTORY_CACHE.clear()
    _HISTORY_CACHE[key] = (now + _HISTORY_TTL_SECONDS, payload)
    return payload
