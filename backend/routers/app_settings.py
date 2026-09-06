from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

import app_settings_crud
import schemas
from admin_utils import user_is_primary_admin
from database import get_db
from dependencies import get_current_admin_user
from models import User

router = APIRouter(prefix="/app-settings", tags=["app-settings"])


@router.get("/", response_model=schemas.AppSettingsResponse)
async def get_app_settings_route(db: AsyncSession = Depends(get_db)):
    row = await app_settings_crud.get_app_settings(db)
    return app_settings_crud.app_settings_to_response(row)


@router.put("/", response_model=schemas.AppSettingsResponse)
async def update_app_settings_route(
    settings_data: schemas.AppSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user)
):
    if settings_data.android_release is not None and not user_is_primary_admin(admin_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Настройки Android-приложения доступны только главному администратору",
        )
    row = await app_settings_crud.update_app_settings(db, settings_data)
    return app_settings_crud.app_settings_to_response(row)
