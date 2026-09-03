"""CRUD новостей ленты для приложения «Спасибо»."""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import crud
import models
import schemas
from avatar_service import resolve_public_avatar_url
from object_storage import delete_object_key, public_url_to_object_key

logger = logging.getLogger(__name__)

_FEED_OBJECT_PREFIXES = ("feed-posts/images/", "feed-posts/documents/")


def user_can_publish_feed_posts(user: models.User) -> bool:
    """Проверяет право писать и редактировать новости."""
    return bool(user.is_admin or user.can_publish_feed_posts)


def _feed_post_load_options():
    """Eager-load для ответа API новости."""
    return (
        selectinload(models.FeedPost.attachments),
        selectinload(models.FeedPost.created_by),
    )


def _user_to_feed_author(user: models.User | None) -> schemas.FeedPostAuthor | None:
    """Преобразует автора новости в DTO."""
    if user is None:
        return None
    return schemas.FeedPostAuthor(
        id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        username=user.username,
        telegram_photo_url=resolve_public_avatar_url(user),
    )


def feed_post_to_response(post: models.FeedPost) -> schemas.FeedPostResponse:
    """Преобразует модель новости в DTO."""
    return schemas.FeedPostResponse(
        id=post.id,
        title=post.title,
        body=post.body,
        is_pinned=post.is_pinned,
        pin_order=post.pin_order,
        is_published=post.is_published,
        created_by_user_id=post.created_by_user_id,
        author=_user_to_feed_author(getattr(post, "created_by", None)),
        published_at=post.published_at,
        created_at=post.created_at,
        updated_at=post.updated_at,
        attachments=[
            schemas.FeedPostAttachmentResponse.model_validate(item)
            for item in post.attachments
        ],
    )


async def get_feed_post_by_id(db: AsyncSession, post_id: int) -> models.FeedPost | None:
    """Загружает новость по id с вложениями и автором."""
    result = await db.execute(
        select(models.FeedPost)
        .options(*_feed_post_load_options())
        .where(models.FeedPost.id == post_id)
    )
    return result.scalars().first()


def _can_view_post(post: models.FeedPost, viewer: models.User | None) -> bool:
    """Проверяет видимость новости для пользователя."""
    if post.is_published:
        return True
    if viewer is None:
        return False
    if post.created_by_user_id == viewer.id:
        return True
    return user_can_publish_feed_posts(viewer)


async def list_visible_feed_posts(
    db: AsyncSession,
    *,
    viewer: models.User | None,
    pinned_only: bool | None = None,
) -> list[models.FeedPost]:
    """Активные новости для пользователя с учётом черновиков."""
    query = (
        select(models.FeedPost)
        .options(*_feed_post_load_options())
        .where(models.FeedPost.is_deleted.is_(False))
        .order_by(
            models.FeedPost.is_pinned.desc(),
            models.FeedPost.pin_order.desc(),
            models.FeedPost.published_at.desc(),
        )
    )
    if pinned_only is True:
        query = query.where(models.FeedPost.is_pinned.is_(True))
    elif pinned_only is False:
        query = query.where(models.FeedPost.is_pinned.is_(False))

    result = await db.execute(query)
    posts = list(result.scalars().unique().all())
    return [post for post in posts if _can_view_post(post, viewer)]


async def list_admin_feed_posts(db: AsyncSession) -> list[models.FeedPost]:
    """Все неудалённые новости для админ-панели."""
    result = await db.execute(
        select(models.FeedPost)
        .options(*_feed_post_load_options())
        .where(models.FeedPost.is_deleted.is_(False))
        .order_by(
            models.FeedPost.created_at.desc(),
            models.FeedPost.id.desc(),
        )
    )
    return list(result.scalars().unique().all())


async def soft_delete_feed_post(
    db: AsyncSession,
    user: models.User,
    post_id: int,
) -> None:
    """Помечает новость удалённой (скрывает из ленты и админ-списка активных)."""
    if not user_can_publish_feed_posts(user):
        raise ValueError("Нет прав на удаление новостей")

    post = await get_feed_post_by_id(db, post_id)
    if post is None or post.is_deleted:
        raise ValueError("Новость не найдена")

    post.is_deleted = True
    post.is_pinned = False
    post.pin_order = 0
    post.updated_at = datetime.utcnow()
    await db.commit()


async def create_publisher_feed_post(
    db: AsyncSession,
    user: models.User,
    payload: schemas.FeedPostPublisherCreate,
) -> models.FeedPost:
    """Создаёт новость ленты из PWA."""
    if not user_can_publish_feed_posts(user):
        raise ValueError("Нет прав на публикацию новостей")

    now = datetime.utcnow()
    post = models.FeedPost(
        title=payload.title.strip(),
        body=(payload.body or "").strip() or None,
        is_pinned=payload.is_pinned,
        pin_order=int(now.timestamp()) if payload.is_pinned else 0,
        is_published=payload.is_published,
        created_by_user_id=user.id,
        published_at=now,
    )
    db.add(post)
    await db.flush()
    await _replace_attachments(db, post.id, payload.attachments)
    await db.commit()

    loaded = await get_feed_post_by_id(db, post.id)
    if loaded and loaded.is_published:
        await _broadcast_feed_post_published(db, loaded)
        await db.commit()
    return loaded or post


async def update_publisher_feed_post(
    db: AsyncSession,
    user: models.User,
    post_id: int,
    payload: schemas.FeedPostPublisherUpdate,
) -> models.FeedPost:
    """Обновляет новость (автор, главный админ или издатель)."""
    if not user_can_publish_feed_posts(user):
        raise ValueError("Нет прав на редактирование новостей")

    post = await get_feed_post_by_id(db, post_id)
    if post is None or post.is_deleted:
        raise ValueError("Новость не найдена")

    data = payload.model_dump(exclude_unset=True, exclude={"attachments"})
    attachments = payload.attachments if "attachments" in payload.model_fields_set else None

    for key, value in data.items():
        setattr(post, key, value)

    if attachments is not None:
        old_urls = [item.url for item in post.attachments]
        await _replace_attachments(db, post.id, attachments)
        new_urls = {item.url.strip() for item in attachments}
        for url in old_urls:
            if url.strip() not in new_urls:
                await _delete_attachment_url(url)

    post.updated_at = datetime.utcnow()
    await db.commit()
    return await get_feed_post_by_id(db, post.id) or post


async def publish_feed_post(
    db: AsyncSession,
    user: models.User,
    post_id: int,
) -> models.FeedPost:
    """Публикует скрытую новость и рассылает уведомления."""
    if not user_can_publish_feed_posts(user):
        raise ValueError("Нет прав на публикацию новостей")

    post = await get_feed_post_by_id(db, post_id)
    if post is None:
        raise ValueError("Новость не найдена")
    if post.is_published:
        return post

    post.is_published = True
    post.published_at = datetime.utcnow()
    post.updated_at = datetime.utcnow()
    await db.commit()

    loaded = await get_feed_post_by_id(db, post.id)
    if loaded:
        await _broadcast_feed_post_published(db, loaded)
        await db.commit()
    return loaded or post


async def set_publisher_feed_post_pinned(
    db: AsyncSession,
    user: models.User,
    post_id: int,
    *,
    pinned: bool,
) -> models.FeedPost:
    """Закрепляет или открепляет свою новость."""
    if not user_can_publish_feed_posts(user):
        raise ValueError("Нет прав на закрепление новостей")

    post = await get_feed_post_by_id(db, post_id)
    if post is None:
        raise ValueError("Новость не найдена")
    if post.created_by_user_id != user.id:
        raise ValueError("Можно закреплять только свои новости")

    post.is_pinned = pinned
    if pinned and post.pin_order <= 0:
        post.pin_order = int(datetime.utcnow().timestamp())
    post.updated_at = datetime.utcnow()
    await db.commit()
    return await get_feed_post_by_id(db, post.id) or post


async def hard_delete_feed_post(db: AsyncSession, post: models.FeedPost) -> None:
    """Hard-delete новости и её файлов из хранилища."""
    for attachment in list(post.attachments):
        await _delete_attachment_url(attachment.url)
    await db.delete(post)


async def _broadcast_feed_post_published(db: AsyncSession, post: models.FeedPost) -> None:
    """Рассылает in-app и push-уведомления об опубликованной новости."""
    body_preview = (post.body or "").strip().replace("\n", " ")
    if len(body_preview) > 120:
        body_preview = body_preview[:117] + "..."
    message = body_preview if body_preview else post.title
    if body_preview and body_preview != post.title:
        message = f"{post.title}\n{body_preview}"

    result = await db.execute(
        select(models.User.id).where(models.User.status == "approved")
    )
    user_ids = [row[0] for row in result.all()]
    for user_id in user_ids:
        await crud._create_notification(
            db,
            user_id,
            "feed_post",
            post.title,
            message,
            click_url="/?panel=home",
        )


async def _replace_attachments(
    db: AsyncSession,
    post_id: int,
    attachments: list[schemas.FeedPostAttachmentInput],
) -> None:
    """Заменяет вложения новости."""
    await db.execute(
        delete(models.FeedPostAttachment).where(
            models.FeedPostAttachment.feed_post_id == post_id,
        ),
    )
    for index, item in enumerate(attachments):
        db.add(
            models.FeedPostAttachment(
                feed_post_id=post_id,
                kind=item.kind,
                url=item.url.strip(),
                filename=item.filename,
                content_type=item.content_type,
                sort_order=item.sort_order if item.sort_order else index,
            ),
        )


async def _delete_attachment_url(url: str) -> None:
    """Удаляет файл вложения из S3."""
    object_key = public_url_to_object_key(url)
    if object_key and _is_allowed_feed_object_key(object_key):
        delete_object_key(object_key)


def _is_allowed_feed_object_key(key: str) -> bool:
    """Разрешает удалять только объекты новостей ленты."""
    normalized = key.strip().lstrip("/")
    return normalized.startswith(_FEED_OBJECT_PREFIXES)
