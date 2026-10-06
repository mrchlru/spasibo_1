"""Небольшие hardening-хелперы: rate limit логина и security headers."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock
from typing import Deque

from fastapi import HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


class LoginRateLimiter:
    """Скользящее окно попыток логина по ключу (IP / login)."""

    def __init__(self, *, max_attempts: int = 8, window_seconds: int = 300) -> None:
        self._max_attempts = max_attempts
        self._window_seconds = window_seconds
        self._hits: dict[str, Deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check_or_raise(self, key: str) -> None:
        """Блокирует ключ при превышении лимита."""
        now = time.monotonic()
        with self._lock:
            bucket = self._hits[key]
            while bucket and now - bucket[0] > self._window_seconds:
                bucket.popleft()
            if len(bucket) >= self._max_attempts:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Слишком много попыток входа. Попробуйте позже.",
                )
            bucket.append(now)

    def reset(self, key: str) -> None:
        """Сбрасывает счётчик после успешного входа."""
        with self._lock:
            self._hits.pop(key, None)


login_rate_limiter = LoginRateLimiter()


def client_ip_from_request(request: Request) -> str:
    """Берёт IP из X-Forwarded-For (первый) или из client.host."""
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Добавляет базовые security headers к ответам API/SPA."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=()",
        )
        # HSTS только для HTTPS (Timeweb терминация TLS снаружи).
        if request.url.scheme == "https" or (
            request.headers.get("x-forwarded-proto", "").lower() == "https"
        ):
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response
