"""Сортировка товаров магазина (drag-and-drop в админке)."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import models


def sort_active_market_items(items: list[models.MarketItem]) -> list[models.MarketItem]:
    """Возвращает активные товары в порядке отображения в магазине."""
    return sorted(items, key=lambda item: (item.sort_order, item.id))


async def reorder_market_items(
    db: AsyncSession,
    ordered_ids: list[int],
) -> list[models.MarketItem]:
    """Сохраняет порядок активных товаров после drag-and-drop."""
    active_result = await db.execute(
        select(models.MarketItem).where(models.MarketItem.is_archived.is_(False))
    )
    active_items = list(active_result.scalars().all())
    allowed_ids = {item.id for item in active_items}
    if set(ordered_ids) != allowed_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Список ID не совпадает с активными товарами",
        )

    id_to_item = {item.id: item for item in active_items}
    for index, item_id in enumerate(ordered_ids):
        id_to_item[item_id].sort_order = index

    await db.commit()
    return sort_active_market_items([id_to_item[item_id] for item_id in ordered_ids])


async def next_market_item_sort_order(db: AsyncSession) -> int:
    """Возвращает sort_order для нового товара (в конец списка)."""
    max_sort = await db.scalar(select(func.max(models.MarketItem.sort_order)))
    return int(max_sort or 0) + 1
