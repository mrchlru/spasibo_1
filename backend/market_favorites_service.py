"""Избранные товары магазина."""

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import crud
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

    existing = await db.execute(
        select(models.MarketItemFavorite.id).where(
            models.MarketItemFavorite.user_id == user_id,
            models.MarketItemFavorite.market_item_id == item_id,
        ),
    )
    if existing.scalar_one_or_none() is not None:
        return

    db.add(models.MarketItemFavorite(user_id=user_id, market_item_id=item_id))
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
    """Возвращает активные избранные товары пользователя."""
    favorite_ids = await get_user_favorite_item_ids(db, user_id)
    if not favorite_ids:
        return []

    active_items = await crud.get_active_items(db)
    return [item for item in active_items if item.id in favorite_ids]


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
