from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import models
import schemas
from database import get_db
from dependencies import get_current_user
from fcm_service import get_active_android_tokens, is_fcm_configured
from push_service import get_vapid_public_key, is_push_configured, send_user_push_with_stats

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key", response_model=schemas.PushVapidPublicKeyResponse)
async def get_public_vapid_key() -> schemas.PushVapidPublicKeyResponse:
    """Публичный VAPID-ключ для подписки браузера на Web Push."""
    return schemas.PushVapidPublicKeyResponse(
        public_key=get_vapid_public_key(),
        enabled=is_push_configured(),
    )


@router.get("/android/config", response_model=schemas.AndroidPushConfigResponse)
async def get_android_push_config() -> schemas.AndroidPushConfigResponse:
    """Статус FCM для нативного Android-приложения."""
    return schemas.AndroidPushConfigResponse(enabled=is_fcm_configured())


@router.get("/android/status", response_model=schemas.AndroidPushStatusResponse)
async def get_android_push_status(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> schemas.AndroidPushStatusResponse:
    """Статус FCM-подписки текущего пользователя (число токенов на сервере)."""
    tokens = await get_active_android_tokens(db, user.id)
    fcm_enabled = is_fcm_configured()
    return schemas.AndroidPushStatusResponse(
        fcm_enabled=fcm_enabled,
        tokens_registered=len(tokens),
        ready=fcm_enabled and len(tokens) > 0,
    )


@router.post("/android/register", status_code=status.HTTP_204_NO_CONTENT)
async def register_android_push(
    body: schemas.AndroidPushRegisterRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Регистрирует FCM-токен Android-устройства текущего пользователя."""
    if not is_fcm_configured():
        raise HTTPException(status_code=503, detail="FCM не настроен на сервере")

    result = await db.execute(
        select(models.AndroidFcmToken).where(models.AndroidFcmToken.token == body.token)
    )
    row = result.scalar_one_or_none()

    if row is None:
        row = models.AndroidFcmToken(
            user_id=user.id,
            token=body.token,
            device_name=body.device_name,
            is_active=True,
        )
        db.add(row)
    else:
        row.user_id = user.id
        row.device_name = body.device_name
        row.is_active = True

    await db.commit()


@router.post("/android/unregister", status_code=status.HTTP_204_NO_CONTENT)
async def unregister_android_push(
    body: schemas.AndroidPushUnregisterRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Деактивирует FCM-токен Android-устройства."""
    result = await db.execute(
        select(models.AndroidFcmToken).where(
            models.AndroidFcmToken.token == body.token,
            models.AndroidFcmToken.user_id == user.id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return

    row.is_active = False
    await db.commit()


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def subscribe_push(
    body: schemas.PushSubscribeRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Сохраняет или обновляет push-подписку текущего пользователя."""
    result = await db.execute(
        select(models.PushSubscription).where(models.PushSubscription.endpoint == body.endpoint)
    )
    subscription = result.scalar_one_or_none()

    if subscription is None:
        subscription = models.PushSubscription(
            user_id=user.id,
            endpoint=body.endpoint,
            p256dh=body.keys.p256dh,
            auth=body.keys.auth,
            is_active=True,
        )
        db.add(subscription)
    else:
        subscription.user_id = user.id
        subscription.p256dh = body.keys.p256dh
        subscription.auth = body.keys.auth
        subscription.is_active = True

    await db.commit()


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe_push(
    body: schemas.PushUnsubscribeRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Деактивирует push-подписку."""
    result = await db.execute(
        select(models.PushSubscription).where(
            models.PushSubscription.endpoint == body.endpoint,
            models.PushSubscription.user_id == user.id,
        )
    )
    subscription = result.scalar_one_or_none()
    if subscription is None:
        return

    subscription.is_active = False
    await db.commit()


@router.post("/test", response_model=schemas.PushTestResponse)
async def send_test_push(
    body: schemas.PushTestRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> schemas.PushTestResponse:
    """Отправляет тестовое push-уведомление текущему пользователю."""
    if not is_push_configured() and not is_fcm_configured():
        raise HTTPException(status_code=503, detail="Push не настроен на сервере")

    stats = await send_user_push_with_stats(
        db,
        user.id,
        title=body.title,
        body=body.body,
        url=body.url,
        tag="spasibo-test",
    )
    await db.commit()
    return schemas.PushTestResponse(**stats)
