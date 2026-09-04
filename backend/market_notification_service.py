"""Push-уведомления о скидках в магазине."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import crud
import models

logger = logging.getLogger(__name__)


def _discount_percent(item: models.MarketItem) -> int | None:
    """Возвращает процент скидки или None, если скидки нет."""
    original = item.original_price
    price = item.price
    if original is None or price is None or original <= price:
        return None
    return round((1 - price / original) * 100)


def should_notify_market_discount(
    old_item: object | None,
    new_item: models.MarketItem,
) -> bool:
    """True, если нужно уведомить пользователей о скидке на товар."""
    new_percent = _discount_percent(new_item)
    if new_percent is None:
        return False
    if old_item is None:
        return True

    old_percent = _discount_percent(old_item)
    if old_percent is None:
        return True
    if new_item.price < old_item.price:
        return True
    return new_percent > old_percent


async def notify_market_discount(
    db: AsyncSession,
    item: models.MarketItem,
) -> int:
    """Рассылает push и in-app уведомление о скидке на товар.

    Returns:
        Число пользователей, которым создано уведомление.
    """
    discount = _discount_percent(item)
    if discount is None:
        return 0

    title = f"Скидка {discount}%"
    message = f"На «{item.name}» действует скидка {discount}% — загляните в магазин!"
    push_tag = f"market-discount-{item.id}-{item.price}-{item.original_price}"

    result = await db.execute(
        select(models.User.id).where(models.User.status == "approved"),
    )
    user_ids = [row[0] for row in result.all()]

    for user_id in user_ids:
        await crud._create_notification(
            db,
            user_id,
            "market_discount",
            title,
            message,
            click_url="/?panel=marketplace",
            push_tag=push_tag,
        )

    if user_ids:
        await db.commit()

    logger.info(
        "Уведомление о скидке на товар id=%s (%s%%): %s пользователей",
        item.id,
        discount,
        len(user_ids),
    )
    return len(user_ids)
