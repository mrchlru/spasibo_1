"""API новогоднего ивента «Подарок» (пользователь + админ)."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

import models
import ny_event_service
from database import get_db
from dependencies import get_current_admin_user, get_current_user
from security_hardening import client_ip_from_request

router = APIRouter(prefix="/ny", tags=["ny-event"])
admin_router = APIRouter(prefix="/admin/ny", tags=["ny-event-admin"])


class NySettingsUpdate(BaseModel):
    """Обновление настроек ивента."""

    is_active: Optional[bool] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    taps_required: Optional[int] = Field(default=None, ge=1, le=50)
    photo_moderation_required: Optional[bool] = None
    low_stock_threshold: Optional[int] = Field(default=None, ge=0, le=100000)


class NyCertificatePatch(BaseModel):
    """Правка сертификата / аннулирование."""

    link_url: Optional[str] = None
    nominal: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None
    action: Optional[str] = None


class NyPhotoVisibilityPatch(BaseModel):
    """Скрыть / показать фото на стене."""

    visible: bool


@router.get("/state")
async def get_ny_state(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Состояние ивента и пользователя."""
    return await ny_event_service.build_state_payload(db, user)


@router.post("/photo")
async def upload_ny_photo(
    request: Request,
    file: UploadFile = File(...),
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Загрузка новогоднего фото участника."""
    raw = await file.read()
    ip = client_ip_from_request(request)
    participant = await ny_event_service.upload_participant_photo(
        db,
        user,
        raw,
        rate_key=f"ny-photo:{user.id}:{ip}",
    )
    return {
        "ok": True,
        "user_state": ny_event_service.resolve_user_state(participant),
        "photo_status": participant.photo_status,
    }


@router.post("/gift/open")
async def open_ny_gift(
    request: Request,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Выдача сертификата (идемпотентно)."""
    ip = client_ip_from_request(request)
    return await ny_event_service.open_gift(db, user, rate_key=f"ny-gift:{user.id}:{ip}")


@router.get("/gift")
async def get_ny_gift(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Мой выданный подарок."""
    return await ny_event_service.get_my_gift(db, user)


@router.get("/gift/image")
async def get_ny_gift_image(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Картинка своего сертификата."""
    data, content_type = await ny_event_service.load_object_for_owner(db, user, kind="full")
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "private, max-age=3600"})


@router.get("/wall")
async def get_ny_wall(
    cursor: int = Query(0, ge=0),
    limit: int = Query(48, ge=1, le=60),
    seed: Optional[str] = Query(None),
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Стена фото участников."""
    return await ny_event_service.list_wall(db, user, cursor=cursor, limit=limit, seed=seed)


@router.get("/wall/{user_id}/photo")
async def get_ny_wall_photo(
    user_id: int,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Полноразмерное фото со стены."""
    data, content_type = await ny_event_service.load_wall_photo(db, user, user_id, thumb=False)
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "private, max-age=600"})


@router.get("/wall/{user_id}/thumb")
async def get_ny_wall_thumb(
    user_id: int,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Миниатюра фото со стены."""
    data, content_type = await ny_event_service.load_wall_photo(db, user, user_id, thumb=True)
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "private, max-age=600"})


@admin_router.get("/settings")
async def admin_get_ny_settings(
    _: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Настройки ивента."""
    settings = await ny_event_service.get_or_create_settings(db)
    return {
        "is_active": settings.is_active,
        "starts_at": settings.starts_at,
        "ends_at": settings.ends_at,
        "taps_required": settings.taps_required,
        "photo_moderation_required": settings.photo_moderation_required,
        "low_stock_threshold": settings.low_stock_threshold,
        "updated_at": settings.updated_at,
        "window_open": ny_event_service.is_event_window_open(settings),
    }


@admin_router.patch("/settings")
async def admin_patch_ny_settings(
    payload: NySettingsUpdate,
    admin: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Обновление настроек ивента."""
    settings = await ny_event_service.update_settings(
        db,
        admin,
        payload.model_dump(exclude_unset=True),
    )
    return {
        "is_active": settings.is_active,
        "starts_at": settings.starts_at,
        "ends_at": settings.ends_at,
        "taps_required": settings.taps_required,
        "photo_moderation_required": settings.photo_moderation_required,
        "low_stock_threshold": settings.low_stock_threshold,
        "updated_at": settings.updated_at,
        "window_open": ny_event_service.is_event_window_open(settings),
    }


@admin_router.post("/certificates/upload")
async def admin_upload_certificates(
    files: list[UploadFile] = File(...),
    links_json: str = Form("{}"),
    links_csv: Optional[UploadFile] = File(None),
    comment: Optional[str] = Form(None),
    admin: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Загрузка пакета сертификатов (картинки + ссылки)."""
    links_by_name: dict[str, dict[str, str]] = {}
    try:
        parsed = json.loads(links_json or "{}")
        if isinstance(parsed, dict):
            for key, value in parsed.items():
                if isinstance(value, str):
                    links_by_name[str(key)] = {"link": value}
                elif isinstance(value, dict):
                    links_by_name[str(key)] = {
                        "link": str(value.get("link") or value.get("link_url") or ""),
                        "nominal": str(value.get("nominal") or ""),
                        "title": str(value.get("title") or ""),
                    }
    except json.JSONDecodeError:
        links_by_name = {}

    if links_csv is not None and (links_csv.filename or "").strip():
        csv_raw = await links_csv.read()
        if csv_raw:
            try:
                links_by_name.update(
                    ny_event_service.parse_links_table_file(
                        links_csv.filename or "links.csv",
                        csv_raw,
                    )
                )
            except HTTPException:
                raise
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(
                    status_code=400,
                    detail=f"Не удалось прочитать файл ссылок: {exc}",
                ) from exc

    return await ny_event_service.create_certificates_batch(
        db,
        admin,
        files=files,
        links_by_name=links_by_name,
        comment=comment,
    )


@admin_router.get("/certificates")
async def admin_list_certificates(
    status: Optional[str] = Query(None),
    batch: Optional[int] = Query(None),
    q: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    _: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Список сертификатов."""
    return await ny_event_service.list_certificates(
        db,
        status_filter=status,
        batch_id=batch,
        q=q,
        page=page,
    )


@admin_router.patch("/certificates/{cert_id}")
async def admin_patch_certificate(
    cert_id: int,
    payload: NyCertificatePatch,
    admin: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Изменить / отключить / аннулировать сертификат."""
    return await ny_event_service.patch_certificate(
        db,
        admin,
        cert_id,
        payload.model_dump(exclude_unset=True),
    )


@admin_router.delete("/certificates/{cert_id}")
async def admin_delete_certificate(
    cert_id: int,
    admin: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Удалить невыданный сертификат."""
    return await ny_event_service.delete_certificate(db, admin, cert_id)


@admin_router.delete("/batches/{batch_id}")
async def admin_delete_batch(
    batch_id: int,
    admin: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Удалить пакет невыданных сертификатов."""
    return await ny_event_service.delete_batch(db, admin, batch_id)


@admin_router.get("/certificates/{cert_id}/thumb")
async def admin_certificate_thumb(
    cert_id: int,
    _: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Превью сертификата для админки."""
    data, content_type = await ny_event_service.load_admin_certificate_image(db, cert_id, thumb=True)
    return Response(content=data, media_type=content_type)


@admin_router.get("/stats")
async def admin_ny_stats(
    _: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Статистика ивента."""
    return await ny_event_service.get_stats(db)


@admin_router.get("/stats/export.csv")
async def admin_ny_stats_export(
    _: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """CSV-экспорт выдач."""
    content = await ny_event_service.export_stats_csv(db)
    return StreamingResponse(
        iter([content]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="ny-event-issued.csv"'},
    )


@admin_router.get("/photos")
async def admin_ny_photos(
    _: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Все загруженные фото для модерации."""
    return {"items": await ny_event_service.list_photos_admin(db)}


@admin_router.patch("/photos/{user_id}")
async def admin_ny_photo_visibility(
    user_id: int,
    payload: NyPhotoVisibilityPatch,
    admin: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Скрыть / вернуть фото на стену."""
    return await ny_event_service.set_photo_visibility(
        db,
        admin,
        user_id,
        visible=payload.visible,
    )


@admin_router.get("/photos/{user_id}/thumb")
async def admin_ny_photo_thumb(
    user_id: int,
    admin: models.User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Миниатюра фото участника для админки."""
    data, content_type = await ny_event_service.load_wall_photo(
        db,
        admin,
        user_id,
        thumb=True,
    )
    return Response(content=data, media_type=content_type)
