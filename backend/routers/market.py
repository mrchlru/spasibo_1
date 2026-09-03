import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

import crud
import models
import schemas
from database import get_db
from dependencies import get_current_user
from redis_cache import redis_cache

logger = logging.getLogger(__name__)

router = APIRouter()

# Публичный список товаров одинаков для всех пользователей, поэтому кешируем
# уже сериализованный JSON: при попадании в кеш не дёргаем БД и не тратим CPU
# на повторную pydantic-сериализацию.
_MARKET_ITEMS_CACHE_KEY = "market:items"
_MARKET_ITEMS_CACHE_TTL = 60  # секунд


@router.get("/market/items", response_model=List[schemas.MarketItemPublic])
async def list_items(db: AsyncSession = Depends(get_db)):
    cached = await redis_cache.get_public_raw(_MARKET_ITEMS_CACHE_KEY)
    if cached is not None:
        # Отдаём готовый JSON-ответ напрямую — это в разы дешевле, чем заново
        # ходить в БД и проводить pydantic-сериализацию для каждого пользователя.
        return Response(content=cached, media_type="application/json")

    items = await crud.get_active_items(db)
    payload = [
        schemas.MarketItemPublic.model_validate(item).model_dump() for item in items
    ]
    raw = json.dumps(payload, ensure_ascii=False)

    try:
        await redis_cache.set_public_raw(
            _MARKET_ITEMS_CACHE_KEY, raw, ttl=_MARKET_ITEMS_CACHE_TTL
        )
    except Exception as exc:  # pragma: no cover — Redis-проблемы не должны валить выдачу
        logger.warning("Не удалось записать публичный кеш market:items: %s", exc)

    return Response(content=raw, media_type="application/json")

@router.post("/market/purchase", response_model=schemas.PurchaseResponse)
async def purchase_item(
    request: schemas.PurchaseRequest, db: AsyncSession = Depends(get_db)
):
    try:
        purchase_result = await crud.create_purchase(db, request)

        return {
            "message": "Purchase successful",
            "new_balance": purchase_result["new_balance"],
            "issued_code": purchase_result["issued_code"],
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

@router.post("/market/local-purchase", response_model=schemas.PurchaseResponse)
async def purchase_local_item(
    request: schemas.LocalGiftRequest, db: AsyncSession = Depends(get_db)
):
    try:
        purchase_result = await crud.create_local_gift(db, request)
        
        return {
            "message": "Local gift request created",
            "new_balance": purchase_result["new_balance"],
            "reserved_balance": purchase_result["reserved_balance"],
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

@router.get("/market/statix-bonus", response_model=schemas.StatixBonusItemResponse)
async def get_statix_bonus_item(db: AsyncSession = Depends(get_db)):
    item = await crud.get_statix_bonus_item(db)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Statix Bonus товар не настроен"
        )
    return item

@router.post("/market/statix-bonus/purchase", response_model=schemas.StatixBonusPurchaseResponse)
async def purchase_statix_bonus(
    request: schemas.StatixBonusPurchaseRequest, db: AsyncSession = Depends(get_db)
):
    try:
        result = await crud.create_statix_bonus_purchase(db, request.user_id, request.bonus_amount)
        return {
            "message": "Statix бонусы успешно приобретены",
            "new_balance": result["new_balance"],
            "purchased_bonus_amount": result["purchased_bonus_amount"]
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/market/purchases/me", response_model=List[schemas.MyPurchaseItemResponse])
async def list_my_purchases(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """История покупок текущего пользователя для профиля."""
    rows = await crud.list_purchases_for_user(db, user.id)
    return [schemas.MyPurchaseItemResponse.model_validate(row) for row in rows]


@router.get("/market/favorites/ids", response_model=schemas.MarketFavoriteIdsResponse)
async def list_favorite_item_ids(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает id избранных товаров текущего пользователя."""
    from market_favorites_service import get_user_favorite_item_ids

    item_ids = sorted(await get_user_favorite_item_ids(db, user.id))
    return schemas.MarketFavoriteIdsResponse(item_ids=item_ids)


@router.get("/market/favorites", response_model=List[schemas.MarketItemPublic])
async def list_favorite_items(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает избранные товары текущего пользователя."""
    from market_favorites_service import get_user_favorite_market_items

    items = await get_user_favorite_market_items(db, user.id)
    return [schemas.MarketItemPublic.model_validate(item) for item in items]


@router.post("/market/favorites/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_favorite_item(
    item_id: int,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Добавляет товар в избранное."""
    from market_favorites_service import add_market_item_favorite

    await add_market_item_favorite(db, user.id, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/market/favorites/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_favorite_item(
    item_id: int,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Удаляет товар из избранного."""
    from market_favorites_service import remove_market_item_favorite

    await remove_market_item_favorite(db, user.id, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
