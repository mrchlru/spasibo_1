"""Публичная лента новостей и CRUD для издателей."""

from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

import feed_post_cleanup_service
import feed_post_service
import feed_service
import schemas
from database import get_db
from dependencies import get_current_user, get_optional_current_user
from feed_post_service import user_can_publish_feed_posts
from models import User
from routers.media_upload import store_uploaded_document_file, store_uploaded_image_file

router = APIRouter()


@router.get("/feed", response_model=List[schemas.UnifiedFeedEntry])
async def get_unified_feed_route(
    days: int = 90,
    limit: int = feed_service.FEED_TRANSACTION_LIMIT,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Объединённая лента: закреплённые новости и активность."""
    safe_limit = min(max(limit, 1), feed_service.FEED_TRANSACTION_LIMIT)
    entries = await feed_service.get_unified_feed(
        db,
        user=current_user,
        days=days,
        limit=safe_limit,
    )
    await feed_post_cleanup_service.cleanup_feed_posts_outside_visible_feed(
        db,
        viewer=current_user,
        days=days,
        limit=safe_limit,
    )
    return entries


@router.post("/feed-posts", response_model=schemas.FeedPostResponse, status_code=status.HTTP_201_CREATED)
async def create_publisher_feed_post_route(
    payload: schemas.FeedPostPublisherCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Публикует новость из PWA."""
    if not user_can_publish_feed_posts(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет прав на публикацию новостей",
        )
    try:
        post = await feed_post_service.create_publisher_feed_post(db, current_user, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return feed_post_service.feed_post_to_response(post)


@router.put("/feed-posts/{post_id}", response_model=schemas.FeedPostResponse)
async def update_publisher_feed_post_route(
    post_id: int,
    payload: schemas.FeedPostPublisherUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Редактирует новость."""
    try:
        post = await feed_post_service.update_publisher_feed_post(
            db,
            current_user,
            post_id,
            payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return feed_post_service.feed_post_to_response(post)


@router.post("/feed-posts/{post_id}/publish", response_model=schemas.FeedPostResponse)
async def publish_feed_post_route(
    post_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Публикует скрытую новость и рассылает уведомления."""
    try:
        post = await feed_post_service.publish_feed_post(db, current_user, post_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return feed_post_service.feed_post_to_response(post)


@router.post("/feed-posts/{post_id}/pin", response_model=schemas.FeedPostResponse)
async def pin_publisher_feed_post_route(
    post_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Закрепляет свою новость в ленте."""
    try:
        post = await feed_post_service.set_publisher_feed_post_pinned(
            db,
            current_user,
            post_id,
            pinned=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return feed_post_service.feed_post_to_response(post)


@router.post("/feed-posts/{post_id}/unpin", response_model=schemas.FeedPostResponse)
async def unpin_publisher_feed_post_route(
    post_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Открепляет свою новость в ленте."""
    try:
        post = await feed_post_service.set_publisher_feed_post_pinned(
            db,
            current_user,
            post_id,
            pinned=False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return feed_post_service.feed_post_to_response(post)


@router.post("/feed-posts/media/upload", response_model=schemas.AdminMediaUploadResponse)
async def upload_publisher_feed_image_route(
    current_user: User = Depends(get_current_user),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Загружает изображение для новости ленты."""
    if not user_can_publish_feed_posts(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет прав на публикацию новостей",
        )
    url = await store_uploaded_image_file(db, file, key_prefix="feed-posts/images")
    return schemas.AdminMediaUploadResponse(url=url, content_type="image/avif")


@router.post("/feed-posts/documents/upload", response_model=schemas.AdminDocumentUploadResponse)
async def upload_publisher_feed_document_route(
    current_user: User = Depends(get_current_user),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Загружает документ для новости ленты."""
    if not user_can_publish_feed_posts(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет прав на публикацию новостей",
        )
    return await store_uploaded_document_file(db, file, key_prefix="feed-posts/documents")
