"""Просмотры и реакции на новости ленты."""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

import models
import schemas

ALLOWED_FEED_REACTIONS: tuple[str, ...] = ("❤️", "👎", "😁", "🔥")


def empty_reaction_counts() -> dict[str, int]:
    """Нулевые счётчики по всем разрешённым реакциям."""
    return {emoji: 0 for emoji in ALLOWED_FEED_REACTIONS}


def normalize_reaction_counts(raw: dict[str, int] | None) -> dict[str, int]:
    """Гарантирует полный набор ключей реакций."""
    counts = empty_reaction_counts()
    if not raw:
        return counts
    for emoji, value in raw.items():
        if emoji in counts:
            counts[emoji] = max(0, int(value or 0))
    return counts


async def load_engagement_for_posts(
    db: AsyncSession,
    post_ids: Iterable[int],
    viewer_id: int | None,
) -> dict[int, schemas.FeedPostEngagement]:
    """Пакетно загружает просмотры и реакции для списка новостей."""
    ids = sorted({int(post_id) for post_id in post_ids if post_id is not None})
    if not ids:
        return {}

    view_rows = (
        await db.execute(
            select(
                models.FeedPostView.feed_post_id,
                func.count(models.FeedPostView.id),
            )
            .where(models.FeedPostView.feed_post_id.in_(ids))
            .group_by(models.FeedPostView.feed_post_id)
        )
    ).all()
    view_counts = {int(post_id): int(count) for post_id, count in view_rows}

    reaction_rows = (
        await db.execute(
            select(
                models.FeedPostReaction.feed_post_id,
                models.FeedPostReaction.emoji,
                func.count(models.FeedPostReaction.id),
            )
            .where(models.FeedPostReaction.feed_post_id.in_(ids))
            .group_by(models.FeedPostReaction.feed_post_id, models.FeedPostReaction.emoji)
        )
    ).all()
    reaction_map: dict[int, dict[str, int]] = defaultdict(empty_reaction_counts)
    for post_id, emoji, count in reaction_rows:
        if emoji in ALLOWED_FEED_REACTIONS:
            reaction_map[int(post_id)][str(emoji)] = int(count)

    my_reactions: dict[int, str] = {}
    if viewer_id is not None:
        my_rows = (
            await db.execute(
                select(
                    models.FeedPostReaction.feed_post_id,
                    models.FeedPostReaction.emoji,
                ).where(
                    models.FeedPostReaction.user_id == viewer_id,
                    models.FeedPostReaction.feed_post_id.in_(ids),
                )
            )
        ).all()
        my_reactions = {
            int(post_id): str(emoji)
            for post_id, emoji in my_rows
            if emoji in ALLOWED_FEED_REACTIONS
        }

    result: dict[int, schemas.FeedPostEngagement] = {}
    for post_id in ids:
        result[post_id] = schemas.FeedPostEngagement(
            view_count=view_counts.get(post_id, 0),
            reaction_counts=normalize_reaction_counts(reaction_map.get(post_id)),
            my_reaction=my_reactions.get(post_id),
        )
    return result


async def register_feed_post_view(
    db: AsyncSession,
    *,
    post: models.FeedPost,
    user: models.User,
) -> int:
    """Фиксирует уникальный просмотр и возвращает актуальный view_count."""
    stmt = (
        pg_insert(models.FeedPostView)
        .values(feed_post_id=post.id, user_id=user.id)
        .on_conflict_do_nothing(constraint="uq_feed_post_view_user")
    )
    await db.execute(stmt)
    await db.commit()

    count = (
        await db.execute(
            select(func.count(models.FeedPostView.id)).where(
                models.FeedPostView.feed_post_id == post.id
            )
        )
    ).scalar_one()
    return int(count)


async def toggle_feed_post_reaction(
    db: AsyncSession,
    *,
    post: models.FeedPost,
    user: models.User,
    emoji: str,
) -> schemas.FeedPostEngagement:
    """Ставит реакцию, снимает при повторном тапе по той же, меняет при другой."""
    if emoji not in ALLOWED_FEED_REACTIONS:
        raise ValueError("Недопустимая реакция")

    existing = (
        await db.execute(
            select(models.FeedPostReaction).where(
                models.FeedPostReaction.feed_post_id == post.id,
                models.FeedPostReaction.user_id == user.id,
            )
        )
    ).scalars().first()

    if existing is not None and existing.emoji == emoji:
        await db.execute(
            delete(models.FeedPostReaction).where(models.FeedPostReaction.id == existing.id)
        )
    elif existing is not None:
        existing.emoji = emoji
    else:
        db.add(
            models.FeedPostReaction(
                feed_post_id=post.id,
                user_id=user.id,
                emoji=emoji,
            )
        )

    await db.commit()
    engagement_map = await load_engagement_for_posts(db, [post.id], user.id)
    return engagement_map.get(
        post.id,
        schemas.FeedPostEngagement(
            view_count=0,
            reaction_counts=empty_reaction_counts(),
            my_reaction=None,
        ),
    )
