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
from routers.media_upload import (
    store_uploaded_document_file,
    store_uploaded_image_file,
    store_uploaded_video_file,
)

router = APIRouter()


@router.get("/feed", response_model=schemas.UnifiedFeedPageResponse)
async def get_unified_feed_route(
    days: int = 90,
    offset: int = 0,
    limit: int = feed_service.FEED_PAGE_DEFAULT,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Объединённая лента: закреплённые новости и активность порциями."""
    safe_offset = max(offset, 0)
    entries, has_more = await feed_service.get_unified_feed_page(
        db,
        user=current_user,
        days=days,
        offset=safe_offset,
        limit=limit,
    )
    if safe_offset == 0:
        await feed_post_cleanup_service.cleanup_feed_posts_outside_visible_feed(
            db,
            viewer=current_user,
            days=days,
            limit=feed_service.FEED_TRANSACTION_LIMIT,
        )
    return schemas.UnifiedFeedPageResponse(
        items=entries,
        offset=safe_offset,
        limit=min(max(limit, 1), feed_service.FEED_PAGE_MAX),
        has_more=has_more,
    )


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


@router.post("/feed-posts/{post_id}/view", response_model=schemas.FeedPostViewResponse)
async def register_feed_post_view_route(
    post_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Регистрирует уникальный просмотр новости текущим пользователем."""
    import feed_engagement_service

    post = await feed_post_service.get_feed_post_by_id(db, post_id)
    if post is None or post.is_deleted or not post.is_published:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Новость не найдена")
    view_count = await feed_engagement_service.register_feed_post_view(
        db,
        post=post,
        user=current_user,
    )
    return schemas.FeedPostViewResponse(view_count=view_count)


@router.post("/feed-posts/{post_id}/reactions", response_model=schemas.FeedPostEngagement)
async def toggle_feed_post_reaction_route(
    post_id: int,
    payload: schemas.FeedPostReactionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ставит или снимает реакцию на новость."""
    import feed_engagement_service

    post = await feed_post_service.get_feed_post_by_id(db, post_id)
    if post is None or post.is_deleted or not post.is_published:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Новость не найдена")
    try:
        return await feed_engagement_service.toggle_feed_post_reaction(
            db,
            post=post,
            user=current_user,
            emoji=payload.emoji,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


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
    return await store_uploaded_image_file(db, file, key_prefix="feed-posts/images")


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


@router.post("/feed-posts/videos/upload", response_model=schemas.AdminDocumentUploadResponse)
async def upload_publisher_feed_video_route(
    current_user: User = Depends(get_current_user),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Загружает видео для новости ленты."""
    if not user_can_publish_feed_posts(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет прав на публикацию новостей",
        )
    return await store_uploaded_video_file(db, file, key_prefix="feed-posts/videos")
