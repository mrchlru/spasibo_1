from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

import crud
import models
import schemas
from database import get_db, settings
from dependencies import get_current_user

router = APIRouter()


async def _verify_cron_or_admin_secret(x_cron_secret: str | None = Header(default=None)) -> None:
    """Cleanup только с секретом планировщика (ADMIN_API_KEY)."""
    expected = (settings.ADMIN_API_KEY or "").strip()
    if not expected or not x_cron_secret or x_cron_secret != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )


@router.post("/shared-gifts/invite", response_model=schemas.SharedGiftInvitationResponse)
async def create_shared_gift_invitation(
    request: schemas.CreateSharedGiftInvitationRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Создаёт приглашение от имени текущего пользователя."""
    if request.buyer_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нельзя создавать приглашение от имени другого пользователя",
        )
    try:
        invitation = await crud.create_shared_gift_invitation(db, request)
        return invitation
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get(
    "/shared-gifts/invitations/{user_id}",
    response_model=List[schemas.SharedGiftInvitationResponse],
)
async def get_user_invitations(
    user_id: int,
    status: str = None,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user_id != user.id and not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав",
        )
    invitations = await crud.get_user_shared_gift_invitations(db, user_id, status)
    return invitations


@router.post("/shared-gifts/accept", response_model=schemas.SharedGiftInvitationActionResponse)
async def accept_invitation(
    request: schemas.AcceptSharedGiftRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if request.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нельзя принять приглашение от имени другого пользователя",
        )
    try:
        result = await crud.accept_shared_gift_invitation(
            db, request.invitation_id, request.user_id
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/shared-gifts/reject", response_model=schemas.SharedGiftInvitationActionResponse)
async def reject_invitation(
    request: schemas.RejectSharedGiftRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if request.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нельзя отклонить приглашение от имени другого пользователя",
        )
    try:
        result = await crud.reject_shared_gift_invitation(
            db, request.invitation_id, request.user_id
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/shared-gifts/cleanup", dependencies=[Depends(_verify_cron_or_admin_secret)])
async def cleanup_expired_invitations(db: AsyncSession = Depends(get_db)):
    """Очистка истекших приглашений — только с x-cron-secret."""
    try:
        cleaned_count = await crud.cleanup_expired_shared_gift_invitations(db)
        return {"message": f"Очищено {cleaned_count} истекших приглашений"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка при очистке: {str(e)}",
        )
