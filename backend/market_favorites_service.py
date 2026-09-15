"""Избранные товары магазина."""

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import models

MARKET_ITEM_DESCRIPTION_MAX_LENGTH = 300


async def get_user_favorite_item_ids(db: AsyncSession, user_id: int) -> set[int]:
    """Возвращает id избранных товаров пользователя."""
    result = await db.execute(
        select(models.MarketItemFavorite.market_item_id).where(
            models.MarketItemFavorite.user_id == user_id,
        ),
    )
    return set(result.scalars().all())


async def add_market_item_favorite(db: AsyncSession, user_id: int, item_id: int) -> None:
    """Добавляет товар в избранное пользователя."""
    item = await db.get(models.MarketItem, item_id)
    if item is None or item.is_archived:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Товар не найден",
        )

    stmt = (
        pg_insert(models.MarketItemFavorite)
        .values(user_id=user_id, market_item_id=item_id)
        .on_conflict_do_nothing(constraint="uq_market_item_favorites_user_item")
    )
    await db.execute(stmt)
    await db.commit()


async def remove_market_item_favorite(db: AsyncSession, user_id: int, item_id: int) -> None:
    """Удаляет товар из избранного пользователя."""
    result = await db.execute(
        select(models.MarketItemFavorite).where(
            models.MarketItemFavorite.user_id == user_id,
            models.MarketItemFavorite.market_item_id == item_id,
        ),
    )
    favorite = result.scalar_one_or_none()
    if favorite is None:
        return
    await db.delete(favorite)
    await db.commit()


async def get_user_favorite_market_items(
    db: AsyncSession,
    user_id: int,
) -> list[models.MarketItem]:
    """Возвращает активные избранные товары пользователя (без полного каталога)."""
    available_codes_subq = (
        select(
            models.ItemCode.market_item_id.label("item_id"),
            func.count(models.ItemCode.id).label("available_count"),
        )
        .where(models.ItemCode.is_issued.is_(False))
        .group_by(models.ItemCode.market_item_id)
        .subquery()
    )

    stmt = (
        select(models.MarketItem, available_codes_subq.c.available_count)
        .join(
            models.MarketItemFavorite,
            models.MarketItemFavorite.market_item_id == models.MarketItem.id,
        )
        .outerjoin(
            available_codes_subq,
            available_codes_subq.c.item_id == models.MarketItem.id,
        )
        .where(
            models.MarketItemFavorite.user_id == user_id,
            models.MarketItem.is_archived.is_(False),
        )
        .order_by(models.MarketItemFavorite.created_at.desc(), models.MarketItem.id.asc())
    )
    rows = (await db.execute(stmt)).all()
    return [_apply_favorite_item_stock(item, available_count) for item, available_count in rows]


async def get_favorite_items_stats(
    db: AsyncSession,
    limit: int = 20,
) -> list[tuple[models.MarketItem, int]]:
    """Возвращает топ товаров по числу добавлений в избранное."""
    query = (
        select(models.MarketItem, func.count(models.MarketItemFavorite.id).label("favorite_count"))
        .join(
            models.MarketItemFavorite,
            models.MarketItemFavorite.market_item_id == models.MarketItem.id,
        )
        .where(models.MarketItem.is_archived.is_(False))
        .options(selectinload(models.MarketItem.codes))
        .group_by(models.MarketItem.id)
        .order_by(func.count(models.MarketItemFavorite.id).desc(), models.MarketItem.id.asc())
        .limit(limit)
    )
    return list((await db.execute(query)).all())


def normalize_market_item_description(description: Optional[str]) -> Optional[str]:
    """Обрезает описание товара до допустимой длины."""
    if description is None:
        return None
    trimmed = description.strip()
    if not trimmed:
        return None
    if len(trimmed) > MARKET_ITEM_DESCRIPTION_MAX_LENGTH:
        raise ValueError(
            f"Описание не должно превышать {MARKET_ITEM_DESCRIPTION_MAX_LENGTH} символов",
        )
    return trimmed


def _apply_favorite_item_stock(
    item: models.MarketItem,
    available_count: int | None,
) -> models.MarketItem:
    """Проставляет остаток на объекте товара так же, как в публичном каталоге."""
    if item.is_auto_issuance:
        item.stock = int(available_count or 0)
    elif item.is_local_purchase:
        if item.stock is None or item.stock <= 0:
            item.stock = 999999
    return item
