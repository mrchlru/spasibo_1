from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Literal

import crud
import models
import schemas
from database import get_db
from dependencies import get_current_user

router = APIRouter()


@router.post("/points/transfer", response_model=schemas.UserResponse)
async def create_new_transaction(
    tr: schemas.TransferRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Перевод спасибки: отправитель только из сессии, не из body."""
    if tr.sender_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нельзя отправлять спасибки от имени другого пользователя",
        )
    try:
        updated_sender = await crud.create_transaction(db=db, tr=tr)
        return schemas.user_response_for_public_api(updated_sender, fair_play_full=True)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/transactions/feed", response_model=list[schemas.FeedItem])
async def get_feed(
    days: int = 90,
    limit: int = 200,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Лента транзакций только для авторизованных пользователей."""
    del user  # auth gate
    rows = await crud.get_feed(db, days=days, limit=limit)
    return [
        schemas.FeedItem(
            id=row.id,
            amount=row.amount,
            message=row.message,
            timestamp=row.timestamp,
            sender=schemas.public_user_brief(row.sender),
            receiver=schemas.public_user_brief(row.receiver),
        )
        for row in rows
        if row.sender is not None and row.receiver is not None
    ]


@router.get("/leaderboard/", response_model=schemas.LeaderboardPageResponse)
async def get_leaderboard(
    period: Literal["current_month", "last_month", "all_time"] = "current_month",
    type: Literal["received", "sent"] = "received",
    offset: int = 0,
    limit: int = 20,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Рейтинг только для авторизованных; в ответе — PublicUserBrief без PII."""
    del user  # auth gate
    safe_limit = min(max(limit, 1), 50)
    safe_offset = max(offset, 0)
    raw_items = await crud.get_leaderboard_data(
        db,
        period=period,
        leaderboard_type=type,
        offset=safe_offset,
        limit=safe_limit,
    )
    has_more = len(raw_items) > safe_limit
    page_items = raw_items[:safe_limit]
    items = [
        schemas.LeaderboardItem(
            user=schemas.public_user_brief(item["user"]),
            total_received=item["total_received"],
        )
        for item in page_items
    ]
    return schemas.LeaderboardPageResponse(
        items=items,
        offset=safe_offset,
        limit=safe_limit,
        has_more=has_more,
    )


@router.get("/leaderboard/my-rank", response_model=schemas.MyRankResponse)
async def get_my_rank(
    period: Literal["current_month", "last_month", "all_time"] = "current_month",
    type: Literal["received", "sent"] = "received",
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await crud.get_user_rank(
        db, user_id=user.id, period=period, leaderboard_type=type
    )


@router.get("/leaderboard/status")
async def get_leaderboards_status_route(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    del user  # auth gate
    return await crud.get_leaderboards_status(db)
