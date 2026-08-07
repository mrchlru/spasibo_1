from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

import schemas
import task_notification_service
import task_service
from database import get_db
from dependencies import get_current_admin_user, get_current_user
from models import User

router = APIRouter()


@router.get("/tasks", response_model=List[schemas.UserTaskResponse])
async def get_user_tasks_route(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Активные задания пользователя с прогрессом."""
    return await task_service.get_user_tasks(db, current_user.id)


@router.get("/admin/tasks", response_model=List[schemas.TaskResponse])
async def get_all_tasks_route(
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    tasks = await task_service.get_all_tasks(db)
    return [task_service.task_to_response(task) for task in tasks]


@router.get("/admin/task-settings", response_model=schemas.TaskQuotaSettingsResponse)
async def get_task_settings_route(
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    settings = await task_service.get_or_create_quota_settings(db)
    return schemas.TaskQuotaSettingsResponse(
        max_daily_tasks=settings.max_daily_tasks,
        max_weekly_tasks=settings.max_weekly_tasks,
        max_monthly_tasks=settings.max_monthly_tasks,
    )


@router.put("/admin/task-settings", response_model=schemas.TaskQuotaSettingsResponse)
async def update_task_settings_route(
    payload: schemas.TaskQuotaSettingsUpdate,
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    settings = await task_service.update_quota_settings(db, payload)
    return schemas.TaskQuotaSettingsResponse(
        max_daily_tasks=settings.max_daily_tasks,
        max_weekly_tasks=settings.max_weekly_tasks,
        max_monthly_tasks=settings.max_monthly_tasks,
    )


@router.post("/admin/tasks", response_model=schemas.TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task_route(
    payload: schemas.TaskCreate,
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        created = await task_service.create_task(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return task_service.task_to_response(created)


@router.put("/admin/tasks/{task_id}", response_model=schemas.TaskResponse)
async def update_task_route(
    task_id: int,
    payload: schemas.TaskUpdate,
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        updated = await task_service.update_task(db, task_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task_service.task_to_response(updated)


@router.delete("/admin/tasks/{task_id}")
async def delete_task_route(
    task_id: int,
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    success = await task_service.delete_task(db, task_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return {"ok": True, "message": "Task deleted successfully"}


@router.post("/admin/tasks/{task_id}/complete-for-user")
async def admin_complete_task_for_user_route(
    task_id: int,
    payload: schemas.AdminCompleteTaskRequest,
    _admin: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Отмечает кастомное задание выполненным для пользователя (управляющий)."""
    try:
        progress = await task_notification_service.admin_complete_task_for_user(
            db,
            task_id=task_id,
            user_id=payload.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {
        "ok": True,
        "user_id": payload.user_id,
        "task_id": task_id,
        "completed": progress.completed_at is not None,
    }
