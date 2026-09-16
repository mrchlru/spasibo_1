"""API реферальной системы."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

import models
import schemas
import referral_service
from database import get_db
from dependencies import get_current_user

router = APIRouter(
    prefix="/referral",
    tags=["referral"],
)


@router.get("/me", response_model=schemas.ReferralSummaryResponse)
async def get_my_referral(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Персональная ссылка, приглашённые и правила акции."""
    return await referral_service.get_my_referral_summary(db, user)


@router.post("/claim", response_model=schemas.ReferralClaimResponse)
async def claim_referral(
    payload: schemas.ReferralClaimRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Привязка существующего (неактивного) пользователя по коду."""
    return await referral_service.claim_referral_for_existing_user(
        db,
        invitee=user,
        referral_code=payload.code,
    )


@router.get("/promo-state", response_model=schemas.ReferralPromoUserStateResponse)
async def get_referral_promo_state(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Состояние показа рекламы рефералки."""
    return await referral_service.get_promo_state(db, user.id)


@router.post("/promo-state/snooze", response_model=schemas.ReferralPromoUserStateResponse)
async def snooze_referral_promo(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отложить рекламу рефералки на несколько дней."""
    return await referral_service.snooze_promo(db, user.id)


@router.post("/promo-state/done", response_model=schemas.ReferralPromoUserStateResponse)
async def mark_referral_promo_done(
    payload: schemas.ReferralPromoDoneRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Пометить рекламу рефералки просмотренной."""
    return await referral_service.mark_promo_done(db, user.id, reason=payload.reason)
