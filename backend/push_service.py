"""Отправка Web Push уведомлений (собственная реализация без OneSignal)."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any

from py_vapid import Vapid
from pywebpush import WebPushException, webpush
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

import models
from config import settings

logger = logging.getLogger(__name__)

_vapid_credentials: Vapid | None = None


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


def _get_vapid_credentials() -> Vapid:
    """Загружает VAPID-ключ один раз (pywebpush не принимает PEM-строку напрямую)."""
    global _vapid_credentials
    if _vapid_credentials is not None:
        return _vapid_credentials

    private_key = settings.VAPID_PRIVATE_KEY.strip()
    if not private_key:
        raise ValueError("VAPID_PRIVATE_KEY не задан")

    _vapid_credentials = Vapid.from_pem(private_key.encode("utf-8"))
    return _vapid_credentials


def _build_click_url(path: str, concept_slug: str | None = None) -> str:
    """Собирает абсолютный URL для перехода из push."""
    normalized_path = path if path.startswith('/') else f'/{path}'
    if concept_slug:
        slug = concept_slug.strip().strip('/')
        if slug:
            if normalized_path == '/':
                normalized_path = f'/{slug}'
            elif normalized_path.startswith('/?'):
                normalized_path = f'/{slug}{normalized_path[1:]}'
    base = settings.PWA_PUBLIC_BASE_URL.strip().rstrip('/')
    if base:
        return f'{base}{normalized_path}'
    return normalized_path


def _truncate_push_body(body: str, max_len: int = 240) -> str:
    """Обрезает текст push для совместимости с лимитами платформ."""
    text = body.strip()
    if len(text) <= max_len:
        return text
    return f'{text[: max_len - 1].rstrip()}…'


def _send_push_sync(subscription_info: dict[str, Any], payload: dict[str, Any]) -> None:
    """Синхронная отправка одного push (вызывается в thread pool)."""
    webpush(
        subscription_info=subscription_info,
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=_get_vapid_credentials(),
        vapid_claims={'sub': settings.VAPID_CONTACT_EMAIL.strip()},
        headers={'Urgency': 'high', 'TTL': '30'},
    )


async def send_push_to_subscription(
    subscription: models.PushSubscription,
    *,
    title: str,
    body: str,
    url: str = '/',
    tag: str | None = None,
) -> tuple[bool, bool]:
    """
    Отправляет push на одну подписку.

    Returns:
        (доставлено, деактивировать_подписку)
    """
    if not is_push_configured():
        return False, False

    subscription_info = {
        'endpoint': subscription.endpoint,
        'keys': {
            'p256dh': subscription.p256dh,
            'auth': subscription.auth,
        },
    }
    payload = {
        'title': title,
        'body': _truncate_push_body(body),
        'url': _build_click_url(url, subscription.concept_slug),
        'tag': tag or f'serdce-{subscription.user_id}-{int(datetime.utcnow().timestamp() * 1000)}',
    }

    try:
        await asyncio.to_thread(_send_push_sync, subscription_info, payload)
        logger.info(
            'Push отправлен user_id=%s tag=%s title=%s',
            subscription.user_id,
            payload['tag'],
            payload['title'],
        )
        return True, False
    except WebPushException as exc:
        status = getattr(getattr(exc, 'response', None), 'status_code', None)
        if status in (404, 410):
            logger.info('Push-подписка недействительна (%s): %s', status, subscription.endpoint[:48])
            return False, True
        logger.warning('Ошибка Web Push: %s', exc)
        return False, False
    except Exception as exc:
        logger.warning('Не удалось отправить push: %s', exc)
        return False, False


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
        logger.info('Web Push: у user_id=%s нет активных подписок', user_id)
        return 0

    delivered = 0
    results = await asyncio.gather(
        *[
            send_push_to_subscription(
                subscription,
                title=title,
                body=body,
                url=url,
                tag=tag,
            )
            for subscription in subscriptions
        ]
    )
    for subscription, (ok, deactivate) in zip(subscriptions, results):
        if ok:
            delivered += 1
            subscription.last_used_at = datetime.utcnow()
        elif deactivate:
            subscription.is_active = False

    if delivered:
        await db.flush()
    logger.info(
        'Web Push: user_id=%s доставлено %s/%s',
        user_id,
        delivered,
        len(subscriptions),
    )
    return delivered


async def send_user_push(
    db: AsyncSession,
    user_id: int,
    *,
    title: str,
    body: str,
    url: str = '/',
    tag: str | None = None,
    concept_slug: str | None = None,
) -> int:
    """Web Push + FCM (Android) для пользователя."""
    web_delivered = await send_user_web_push(
        db,
        user_id,
        title=title,
        body=body,
        url=url,
        tag=tag,
    )
    try:
        from fcm_service import send_user_fcm_push

        fcm_delivered = await send_user_fcm_push(
            db,
            user_id,
            title=title,
            body=body,
            url=url,
            tag=tag,
            concept_slug=concept_slug,
        )
    except Exception as exc:
        logger.warning("FCM для user_id=%s не отправлен: %s", user_id, exc)
        fcm_delivered = 0
    return web_delivered + fcm_delivered
