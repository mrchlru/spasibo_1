"""Сборка объединённой ленты: закреплённые новости + активность."""

from __future__ import annotations

from datetime import datetime

import crud
import feed_post_service
import models
import schemas
from avatar_service import resolve_public_avatar_url
from sqlalchemy.ext.asyncio import AsyncSession

FEED_TRANSACTION_LIMIT = 200


async def get_unified_feed(
    db: AsyncSession,
    *,
    user: models.User | None,
    days: int = 90,
    limit: int = FEED_TRANSACTION_LIMIT,
) -> list[schemas.UnifiedFeedEntry]:
    """Возвращает ленту: закреплённые новости, затем до limit записей активности."""
    import birthday_service

    safe_limit = min(max(limit, 1), FEED_TRANSACTION_LIMIT)

    pinned_posts = await feed_post_service.list_visible_feed_posts(
        db,
        viewer=user,
        pinned_only=True,
    )
    regular_posts = await feed_post_service.list_visible_feed_posts(
        db,
        viewer=user,
        pinned_only=False,
    )
    transactions = await crud.get_feed(db, days=days, limit=safe_limit)
    birthday_users = await birthday_service.list_today_birthday_users(db)
    birthday_timestamp = birthday_service.birthday_stream_timestamp()

    entries: list[schemas.UnifiedFeedEntry] = []
    for post in pinned_posts:
        entries.append(_post_entry(post))

    stream_items: list[tuple[datetime, schemas.UnifiedFeedEntry]] = []
    for post in regular_posts:
        stream_items.append((post.published_at, _post_entry(post)))
    for transaction in transactions:
        stream_items.append((transaction.timestamp, _transaction_entry(transaction)))
    for birthday_user in birthday_users:
        stream_items.append(
            (
                birthday_timestamp,
                _birthday_entry(birthday_user),
            ),
        )

    stream_items.sort(key=lambda item: item[0], reverse=True)
    entries.extend(entry for _, entry in stream_items[:safe_limit])
    return entries


def collect_visible_post_ids(entries: list[schemas.UnifiedFeedEntry]) -> set[int]:
    """Собирает id новостей, которые сейчас отображаются в ленте."""
    visible: set[int] = set()
    for entry in entries:
        if entry.kind == "post" and entry.post is not None:
            visible.add(entry.post.id)
    return visible


def _post_entry(post: models.FeedPost) -> schemas.UnifiedFeedEntry:
    """Собирает элемент ленты из новости."""
    return schemas.UnifiedFeedEntry(
        kind="post",
        timestamp=post.published_at,
        post=feed_post_service.feed_post_to_response(post),
        transaction=None,
        birthday=None,
    )


def _transaction_entry(transaction: models.Transaction) -> schemas.UnifiedFeedEntry:
    """Собирает элемент ленты из транзакции."""
    sender = transaction.sender
    receiver = transaction.receiver
    if sender is None or receiver is None:
        raise ValueError(f"Транзакция {transaction.id} без участников")

    sender_dto = schemas.UserBase.model_validate(sender)
    receiver_dto = schemas.UserBase.model_validate(receiver)
    sender_dto = sender_dto.model_copy(
        update={"telegram_photo_url": resolve_public_avatar_url(sender)},
    )
    receiver_dto = receiver_dto.model_copy(
        update={"telegram_photo_url": resolve_public_avatar_url(receiver)},
    )

    return schemas.UnifiedFeedEntry(
        kind="transaction",
        timestamp=transaction.timestamp,
        post=None,
        transaction=schemas.FeedItem(
            id=transaction.id,
            amount=transaction.amount,
            message=transaction.message,
            timestamp=transaction.timestamp,
            sender=sender_dto,
            receiver=receiver_dto,
        ),
        birthday=None,
    )


def _birthday_entry(user: models.User) -> schemas.UnifiedFeedEntry:
    """Собирает элемент ленты о дне рождения."""
    import birthday_service

    return schemas.UnifiedFeedEntry(
        kind="birthday",
        timestamp=birthday_service.birthday_stream_timestamp(),
        post=None,
        transaction=None,
        birthday=birthday_service.birthday_feed_item(user),
    )
