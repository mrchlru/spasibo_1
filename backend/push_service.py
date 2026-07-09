"""Отправка Web Push уведомлений (собственная реализация без OneSignal)."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any

from pywebpush import WebPushException, webpush
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

import models
from config import settings

logger = logging.getLogger(__name__)


def is_push_configured() -> bool:
    """Проверяет, заданы ли VAPID-ключи для отправки push."""
    return bool(
        settings.WEB_PUSH_ENABLED
        and settings.VAPID_PUBLIC_KEY.strip()
        and settings.VAPID_PRIVATE_KEY.strip()
    )


def get_vapid_public_key() -> str:
    """Возвращает публичный VAPID-ключ для подписки в браузере."""
    return settings.VAPID_PUBLIC_KEY.strip()


def _build_click_url(path: str) -> str:
    """Собирает абсолютный URL для перехода из push."""
    normalized_path = path if path.startswith('/') else f'/{path}'
    base = settings.PWA_PUBLIC_BASE_URL.strip().rstrip('/')
    if base:
        return f'{base}{normalized_path}'
    return normalized_path


def _send_push_sync(subscription_info: dict[str, Any], payload: dict[str, Any]) -> None:
    """Синхронная отправка одного push (вызывается в thread pool)."""
    webpush(
        subscription_info=subscription_info,
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=settings.VAPID_PRIVATE_KEY.strip(),
        vapid_claims={'sub': settings.VAPID_CONTACT_EMAIL.strip()},
    )


async def send_push_to_subscription(
    subscription: models.PushSubscription,
    *,
    title: str,
    body: str,
    url: str = '/',
    tag: str | None = None,
) -> bool:
    """Отправляет push на одну подписку. Возвращает False, если подписка мёртвая."""
    if not is_push_configured():
        return False

    subscription_info = {
        'endpoint': subscription.endpoint,
        'keys': {
            'p256dh': subscription.p256dh,
            'auth': subscription.auth,
        },
    }
    payload = {
        'title': title,
        'body': body,
        'url': _build_click_url(url),
        'tag': tag or f'serdce-{subscription.user_id}',
    }

    try:
        await asyncio.to_thread(_send_push_sync, subscription_info, payload)
        return True
    except WebPushException as exc:
        status = getattr(getattr(exc, 'response', None), 'status_code', None)
        if status in (404, 410):
            logger.info('Push-подписка недействительна (%s): %s', status, subscription.endpoint[:48])
            return False
        logger.warning('Ошибка Web Push: %s', exc)
        return False
    except Exception as exc:
        logger.warning('Не удалось отправить push: %s', exc)
        return False


async def get_active_subscriptions(db: AsyncSession, user_id: int) -> list[models.PushSubscription]:
    """Возвращает активные push-подписки пользователя."""
    result = await db.execute(
        select(models.PushSubscription).where(
            models.PushSubscription.user_id == user_id,
            models.PushSubscription.is_active.is_(True),
        )
    )
    return list(result.scalars().all())


async def deactivate_subscription(db: AsyncSession, subscription_id: int) -> None:
    """Помечает подписку неактивной."""
    await db.execute(
        update(models.PushSubscription)
        .where(models.PushSubscription.id == subscription_id)
        .values(is_active=False)
    )


async def send_user_web_push(
    db: AsyncSession,
    user_id: int,
    *,
    title: str,
    body: str,
    url: str = '/',
    tag: str | None = None,
) -> int:
    """
    Отправляет push на все активные устройства пользователя.

    Returns:
        Количество успешных доставок.
    """
    if not is_push_configured():
        return 0

    subscriptions = await get_active_subscriptions(db, user_id)
    if not subscriptions:
        return 0

    delivered = 0
    for subscription in subscriptions:
        ok = await send_push_to_subscription(
            subscription,
            title=title,
            body=body,
            url=url,
            tag=tag,
        )
        if ok:
            delivered += 1
            subscription.last_used_at = datetime.utcnow()
        else:
            subscription.is_active = False

    if delivered:
        await db.flush()
    return delivered
