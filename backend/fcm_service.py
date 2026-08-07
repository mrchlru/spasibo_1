"""Отправка push-уведомлений на Android через Firebase Cloud Messaging."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any

from firebase_admin import credentials, initialize_app, messaging
from firebase_admin.exceptions import FirebaseError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

import models
from config import settings
from push_service import _build_click_url, _truncate_push_body

logger = logging.getLogger(__name__)

_firebase_ready = False


def is_fcm_configured() -> bool:
    """Проверяет, задан ли service account Firebase для FCM."""
    return bool(settings.FCM_ENABLED and settings.FIREBASE_SERVICE_ACCOUNT_JSON.strip())


def _ensure_firebase_app() -> bool:
    global _firebase_ready
    if _firebase_ready:
        return True
    if not is_fcm_configured():
        return False

    try:
        service_account = json.loads(settings.FIREBASE_SERVICE_ACCOUNT_JSON)
        cred = credentials.Certificate(service_account)
        initialize_app(cred)
        _firebase_ready = True
        return True
    except Exception as exc:
        logger.warning("Firebase Admin SDK не инициализирован: %s", exc)
        return False


async def get_active_android_tokens(db: AsyncSession, user_id: int) -> list[models.AndroidFcmToken]:
    result = await db.execute(
        select(models.AndroidFcmToken).where(
            models.AndroidFcmToken.user_id == user_id,
            models.AndroidFcmToken.is_active.is_(True),
        )
    )
    return list(result.scalars().all())


async def deactivate_android_token(db: AsyncSession, token_id: int) -> None:
    await db.execute(
        update(models.AndroidFcmToken)
        .where(models.AndroidFcmToken.id == token_id)
        .values(is_active=False)
    )


def _send_fcm_sync(token: str, payload: dict[str, Any]) -> tuple[bool, bool]:
    """
    Returns:
        (delivered, deactivate_token)
    """
    if not _ensure_firebase_app():
        return False, False

    title = str(payload.get("title") or "Сердце")
    body = str(payload.get("body") or "")
    url = str(payload.get("url") or "/")
    tag = str(payload.get("tag") or "serdce")

    message = messaging.Message(
        token=token,
        notification=messaging.Notification(title=title, body=body),
        data={
            "title": title,
            "body": body,
            "url": url,
            "tag": tag,
        },
        android=messaging.AndroidConfig(
            priority="high",
            notification=messaging.AndroidNotification(
                click_action="OPEN_HEARTH_URL",
                tag=tag,
            ),
        ),
    )

    try:
        messaging.send(message)
        return True, False
    except FirebaseError as exc:
        code = getattr(exc, "code", None)
        if code in ("NOT_FOUND", "UNREGISTERED", "INVALID_ARGUMENT"):
            return False, True
        logger.warning("FCM send error: %s", exc)
        return False, False
    except Exception as exc:
        logger.warning("FCM send failed: %s", exc)
        return False, False


async def send_user_fcm_push(
    db: AsyncSession,
    user_id: int,
    *,
    title: str,
    body: str,
    url: str = "/",
    tag: str | None = None,
    concept_slug: str | None = None,
) -> int:
    if not is_fcm_configured():
        return 0

    tokens = await get_active_android_tokens(db, user_id)
    if not tokens:
        return 0

    payload = {
        "title": title,
        "body": _truncate_push_body(body),
        "url": _build_click_url(url, concept_slug),
        "tag": tag or f"serdce-android-{user_id}-{int(datetime.utcnow().timestamp() * 1000)}",
    }

    delivered = 0
    for row in tokens:
        ok, deactivate = await asyncio.to_thread(_send_fcm_sync, row.token, payload)
        if ok:
            delivered += 1
            row.last_used_at = datetime.utcnow()
        elif deactivate:
            row.is_active = False

    if delivered:
        await db.flush()

    logger.info("FCM: user_id=%s доставлено %s/%s", user_id, delivered, len(tokens))
    return delivered
