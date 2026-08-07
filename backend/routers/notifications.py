from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

import models
import schemas
from database import get_db
from dependencies import get_current_user
from notification_preferences import user_allows_notification

router = APIRouter(
    prefix="/notifications",
    tags=["notifications"],
)


def _filter_notifications_for_user(
    user: models.User,
    items: list[models.Notification],
) -> list[models.Notification]:
    """Оставляет только уведомления, разрешённые настройками пользователя."""
    return [
        item
        for item in items
        if user_allows_notification(user.notification_preferences, item.type, item.title)
    ]


@router.get("", response_model=schemas.NotificationListResponse)
async def list_notifications(
    type: Optional[str] = Query(None, description="Filter by type: purchase, profile, system, transfer, shared_gift"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> schemas.NotificationListResponse:
    """Возвращает список уведомлений текущего пользователя."""
    base_filter = models.Notification.user_id == user.id
    type_filter = models.Notification.type == type if type else True

    items_result = await db.execute(
        select(models.Notification)
        .where(base_filter, type_filter)
        .order_by(models.Notification.created_at.desc())
    )
    all_items = items_result.scalars().all()
    filtered_items = _filter_notifications_for_user(user, all_items)

    total = len(filtered_items)
    unread_count = sum(1 for item in filtered_items if not item.is_read)

    offset = (page - 1) * per_page
    page_items = filtered_items[offset : offset + per_page]

    return schemas.NotificationListResponse(
        items=[schemas.NotificationResponse.model_validate(n) for n in page_items],
        total=total,
        unread_count=unread_count,
    )


@router.get("/unread-count")
async def get_unread_count(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Возвращает количество непрочитанных уведомлений."""
    result = await db.execute(
        select(models.Notification).where(
            models.Notification.user_id == user.id,
            models.Notification.is_read == False,  # noqa: E712
        )
    )
    items = _filter_notifications_for_user(user, result.scalars().all())
    return {"unread_count": len(items)}


@router.put("/{notification_id}/read")
async def mark_as_read(
    notification_id: int,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Помечает уведомление как прочитанное."""
    notification = await db.get(models.Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if not user_allows_notification(user.notification_preferences, notification.type, notification.title):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notification.is_read = True
    await db.commit()
    return {"ok": True}


@router.put("/read-all")
async def mark_all_as_read(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Помечает все уведомления пользователя как прочитанные."""
    result = await db.execute(
        select(models.Notification).where(
            models.Notification.user_id == user.id,
            models.Notification.is_read == False,  # noqa: E712
        )
    )
    allowed_ids = [
        item.id
        for item in _filter_notifications_for_user(user, result.scalars().all())
    ]
    if allowed_ids:
        await db.execute(
            update(models.Notification)
            .where(models.Notification.id.in_(allowed_ids))
            .values(is_read=True)
        )
        await db.commit()
    return {"ok": True}
