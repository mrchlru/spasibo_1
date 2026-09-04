"""Очистка новостей, выпавших из видимой ленты, и их файлов."""

from __future__ import annotations

import logging

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import feed_post_service
import feed_service
import models

logger = logging.getLogger(__name__)


class FeedPostCleanupStats(BaseModel):
    """Результат очистки новостей вне ленты."""

    posts_deleted: int = 0
    posts_skipped: int = 0


async def cleanup_feed_posts_outside_visible_feed(
    db: AsyncSession,
    *,
    viewer: models.User | None = None,
    days: int = 90,
    limit: int = feed_service.FEED_TRANSACTION_LIMIT,
) -> FeedPostCleanupStats:
    """Удаляет незакреплённые опубликованные новости, не попавшие в текущую ленту."""
    stats = FeedPostCleanupStats()
    entries = await feed_service.get_unified_feed(
        db,
        user=viewer,
        days=days,
        limit=limit,
    )
    visible_ids = feed_service.collect_visible_post_ids(entries)

    result = await db.execute(
        select(models.FeedPost)
        .options(selectinload(models.FeedPost.attachments))
        .where(
            models.FeedPost.is_pinned.is_(False),
            models.FeedPost.is_published.is_(True),
            models.FeedPost.is_deleted.is_(False),
        )
    )
    candidates = list(result.scalars().unique().all())

    for post in candidates:
        if post.id in visible_ids:
            continue
        try:
            await feed_post_service.hard_delete_feed_post(db, post)
            stats.posts_deleted += 1
        except Exception as exc:
            stats.posts_skipped += 1
            logger.warning("Не удалось удалить новость %s: %s", post.id, exc)

    if stats.posts_deleted:
        await db.commit()
        logger.info(
            "Очистка ленты: удалено новостей=%s, пропущено=%s",
            stats.posts_deleted,
            stats.posts_skipped,
        )
    return stats
