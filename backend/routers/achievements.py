from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

import crud
import schemas
from database import get_db
from dependencies import get_current_admin_user, get_current_user
from models import User

router = APIRouter()


@router.get("/achievements", response_model=List[schemas.UserAchievementResponse])
async def get_user_achievements_route(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Каталог активных ачивок со статусом получения для текущего пользователя."""
    achievements = await crud.get_active_achievements(db)
    earned_map = await crud.get_user_earned_achievement_ids(db, current_user.id)
    return crud.build_user_achievement_responses(achievements, earned_map)


@router.get("/admin/achievements", response_model=List[schemas.AchievementResponse])
async def get_all_achievements_route(
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await crud.get_all_achievements(db)


@router.post(
    "/admin/achievements",
    response_model=schemas.AchievementResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_achievement_route(
    achievement: schemas.AchievementCreate,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await crud.create_achievement(db, achievement)


@router.put("/admin/achievements/{achievement_id}", response_model=schemas.AchievementResponse)
async def update_achievement_route(
    achievement_id: int,
    achievement_data: schemas.AchievementUpdate,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    updated = await crud.update_achievement(db, achievement_id, achievement_data)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Achievement not found")
    return updated


@router.delete("/admin/achievements/{achievement_id}")
async def delete_achievement_route(
    achievement_id: int,
    admin_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    success = await crud.delete_achievement(db, achievement_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Achievement not found")
    return {"ok": True, "message": "Achievement deleted successfully"}
