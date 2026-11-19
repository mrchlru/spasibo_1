"""Бизнес-логика новогоднего ивента «Подарок»."""

from __future__ import annotations

import csv
import io
import logging
import random
import zipfile
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import Select, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

import models
from object_storage import (
    build_public_url,
    delete_object_key,
    download_object_bytes,
    generate_media_object_key,
    generate_ny_certificate_object_keys,
    is_object_storage_configured,
    upload_bytes,
)
from ny_event_image import (
    allowed_certificate_ext,
    encode_participant_photo,
    prepare_certificate_asset,
)
from security_hardening import LoginRateLimiter

logger = logging.getLogger(__name__)

ny_photo_rate_limiter = LoginRateLimiter(max_attempts=12, window_seconds=600)
ny_gift_rate_limiter = LoginRateLimiter(max_attempts=20, window_seconds=300)


def _utcnow() -> datetime:
    return datetime.utcnow()


def _display_name(user: models.User | None) -> str:
    if user is None:
        return "Участник"
    name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return name or (user.username and f"@{user.username}") or f"ID {user.id}"


def _is_valid_http_url(value: str) -> bool:
    parsed = urlparse((value or "").strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _json_safe(value: Any) -> Any:
    """Приводит datetime и вложенные структуры к JSON-сериализуемому виду."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _as_naive_utc(value: Any) -> Any:
    """Убирает tzinfo: колонки TIMESTAMP WITHOUT TIME ZONE ждут naive datetime."""
    if not isinstance(value, datetime):
        return value
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _resolve_certificate_link_and_title(
    *,
    meta_link: str,
    meta_title: str,
) -> tuple[str | None, str | None]:
    """Разбирает поле ссылки: URL оставляем, иначе считаем названием."""
    link = (meta_link or "").strip()
    title = (meta_title or "").strip() or None
    if not link:
        return None, title
    if _is_valid_http_url(link):
        return link, title
    # Вручную часто пишут название подарка вместо URL — файл не отбрасываем.
    if not title:
        title = link
    return None, title


async def _write_log(
    db: AsyncSession,
    *,
    user_id: int | None,
    event_type: str,
    payload: dict[str, Any] | None = None,
) -> None:
    db.add(
        models.NyEventLog(
            user_id=user_id,
            event_type=event_type,
            payload=payload,
        )
    )


async def get_or_create_settings(db: AsyncSession) -> models.NyEventSettings:
    """Возвращает единственную запись настроек, создавая при необходимости."""
    result = await db.execute(select(models.NyEventSettings).order_by(models.NyEventSettings.id).limit(1))
    settings = result.scalar_one_or_none()
    if settings:
        return settings
    settings = models.NyEventSettings()
    db.add(settings)
    await db.commit()
    await db.refresh(settings)
    return settings


def is_event_window_open(settings: models.NyEventSettings, *, now: datetime | None = None) -> bool:
    """True, если ивент включён и текущее время попадает в период."""
    if not settings.is_active:
        return False
    current = now or _utcnow()
    if settings.starts_at and current < settings.starts_at:
        return False
    if settings.ends_at and current > settings.ends_at:
        return False
    return True


def resolve_user_state(participant: models.NyParticipant | None) -> str:
    """Состояние пользователя для клиента."""
    if participant is None:
        return "not_started"
    if participant.gift_opened_at and participant.certificate_id:
        return "gift_opened"
    return "photo_uploaded"


async def count_visible_participants(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(models.NyParticipant)
        .where(models.NyParticipant.photo_status == "visible")
    )
    return int(result.scalar_one() or 0)


async def get_participant(db: AsyncSession, user_id: int) -> models.NyParticipant | None:
    result = await db.execute(
        select(models.NyParticipant).where(models.NyParticipant.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def build_state_payload(db: AsyncSession, user: models.User) -> dict[str, Any]:
    """Сводка состояния ивента для авторизованного пользователя."""
    settings = await get_or_create_settings(db)
    participant = await get_participant(db, user.id)
    user_state = resolve_user_state(participant)
    event_open = is_event_window_open(settings)
    event_ended = bool(settings.ends_at and _utcnow() > settings.ends_at)
    await _write_log(db, user_id=user.id, event_type="open_screen", payload={"state": user_state})
    await db.commit()
    return {
        "is_active": event_open,
        "event_ended": event_ended and not event_open,
        "starts_at": settings.starts_at,
        "ends_at": settings.ends_at,
        "taps_required": settings.taps_required,
        "photo_moderation_required": settings.photo_moderation_required,
        "user_state": user_state,
        "participants_count": await count_visible_participants(db),
        "has_photo": participant is not None,
        "photo_status": participant.photo_status if participant else None,
        "gift_opened_at": participant.gift_opened_at if participant else None,
        "banner_visible": event_open or user_state == "gift_opened" or event_ended,
        "banner_subtitle": (
            "Смотри фото всех коллег"
            if user_state == "gift_opened" or event_ended
            else "Загрузи фото с ёлкой и открой подарок"
        ),
    }


async def _upload_pair(
    *,
    prefix: str,
    full_bytes: bytes,
    thumb_bytes: bytes,
    full_ext: str = "jpg",
    full_content_type: str = "image/jpeg",
) -> tuple[str, str]:
    if not is_object_storage_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Хранилище файлов не настроено",
        )
    full_key = generate_media_object_key(prefix=prefix, extension=full_ext)
    thumb_key = generate_media_object_key(prefix=f"{prefix}-thumbs", extension="jpg")
    upload_bytes(full_key, full_bytes, full_content_type)
    upload_bytes(thumb_key, thumb_bytes, "image/jpeg")
    return full_key, thumb_key


async def _upload_certificate_pair(
    *,
    filename: str,
    full_bytes: bytes,
    thumb_bytes: bytes,
    full_ext: str,
    full_content_type: str,
) -> tuple[str, str, str]:
    """Сохраняет сертификат в S3-папку по имени файла и возвращает ключи + публичный URL."""
    if not is_object_storage_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Хранилище файлов не настроено",
        )
    full_key, thumb_key = generate_ny_certificate_object_keys(
        filename,
        extension=full_ext,
    )
    file_url = upload_bytes(full_key, full_bytes, full_content_type)
    upload_bytes(thumb_key, thumb_bytes, "image/jpeg")
    return full_key, thumb_key, file_url


async def upload_participant_photo(
    db: AsyncSession,
    user: models.User,
    raw: bytes,
    *,
    rate_key: str,
) -> models.NyParticipant:
    """Загружает/заменяет фото участника до открытия подарка."""
    ny_photo_rate_limiter.check_or_raise(rate_key)
    settings = await get_or_create_settings(db)
    if not is_event_window_open(settings):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ивент сейчас недоступен")

    participant = await get_participant(db, user.id)
    if participant and participant.gift_opened_at:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Подарок уже открыт, фото заменить нельзя",
        )

    try:
        full_bytes, thumb_bytes = encode_participant_photo(raw)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    full_key, thumb_key = await _upload_pair(
        prefix="ny-photos",
        full_bytes=full_bytes,
        thumb_bytes=thumb_bytes,
    )

    photo_status = "hidden" if settings.photo_moderation_required else "visible"
    old_keys: list[str] = []
    if participant is None:
        participant = models.NyParticipant(
            user_id=user.id,
            photo_key=full_key,
            photo_thumb_key=thumb_key,
            photo_status=photo_status,
            photo_uploaded_at=_utcnow(),
        )
        db.add(participant)
    else:
        old_keys = [participant.photo_key, participant.photo_thumb_key or ""]
        participant.photo_key = full_key
        participant.photo_thumb_key = thumb_key
        participant.photo_status = photo_status
        participant.photo_uploaded_at = _utcnow()

    await _write_log(
        db,
        user_id=user.id,
        event_type="photo_uploaded",
        payload={"photo_status": photo_status},
    )
    await db.commit()
    await db.refresh(participant)

    for key in old_keys:
        if key:
            delete_object_key(key)
    return participant


async def _fetch_certificate_for_user(
    db: AsyncSession,
    user_id: int,
) -> models.NyCertificate | None:
    result = await db.execute(
        select(models.NyCertificate).where(models.NyCertificate.issued_to_user_id == user_id)
    )
    return result.scalar_one_or_none()


def serialize_gift(cert: models.NyCertificate) -> dict[str, Any]:
    """Публичное представление выданного подарка (без утечки чужих ссылок)."""
    return {
        "certificate_id": cert.id,
        "title": cert.title,
        "nominal": cert.nominal,
        "link_url": cert.link_url,
        "image_url": "/ny/gift/image",
        "content_type": cert.content_type or "image/jpeg",
        "original_filename": cert.original_filename,
        "issued_at": cert.issued_at,
    }


async def open_gift(db: AsyncSession, user: models.User, *, rate_key: str) -> dict[str, Any]:
    """Атомарно выдаёт сертификат после загрузки фото (идемпотентно)."""
    ny_gift_rate_limiter.check_or_raise(rate_key)
    settings = await get_or_create_settings(db)
    if not is_event_window_open(settings):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ивент сейчас недоступен")

    participant = await get_participant(db, user.id)
    if participant is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Сначала загрузите новогоднее фото",
        )

    if participant.gift_opened_at and participant.certificate_id:
        cert = await db.get(models.NyCertificate, participant.certificate_id)
        if cert is None:
            cert = await _fetch_certificate_for_user(db, user.id)
        if cert is None:
            raise HTTPException(status_code=500, detail="Подарок не найден")
        return serialize_gift(cert)

    existing = await _fetch_certificate_for_user(db, user.id)
    if existing is not None:
        first_open = participant.gift_opened_at is None
        participant.certificate_id = existing.id
        participant.gift_opened_at = existing.issued_at or _utcnow()
        await db.commit()
        if first_open:
            await _deliver_gift_notifications(db, user, existing)
        return serialize_gift(existing)

    # Атомарная выдача через SKIP LOCKED (PostgreSQL).
    result = await db.execute(
        text(
            """
            UPDATE ny_certificates
            SET status = 'issued',
                issued_to_user_id = :uid,
                issued_at = NOW()
            WHERE id = (
                SELECT id FROM ny_certificates
                WHERE status = 'available'
                  AND link_url IS NOT NULL
                  AND BTRIM(link_url) <> ''
                ORDER BY random()
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id
            """
        ),
        {"uid": user.id},
    )
    row = result.first()
    if row is None:
        await _write_log(db, user_id=user.id, event_type="no_stock", payload={})
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "NO_STOCK", "message": "Подарки закончились. Твоё фото останется на стене коллег"},
        )

    cert_id = int(row[0])
    participant.certificate_id = cert_id
    participant.gift_opened_at = _utcnow()
    await _write_log(
        db,
        user_id=user.id,
        event_type="gift_issued",
        payload={"certificate_id": cert_id},
    )
    await db.commit()

    cert = await db.get(models.NyCertificate, cert_id)
    if cert is None:
        raise HTTPException(status_code=500, detail="Подарок не найден после выдачи")
    await _deliver_gift_notifications(db, user, cert)
    return serialize_gift(cert)


async def _deliver_gift_notifications(
    db: AsyncSession,
    user: models.User,
    cert: models.NyCertificate,
) -> None:
    """Пишет уведомление и шлёт ссылку в Telegram/email (best-effort)."""
    import crud
    from bot import send_telegram_message
    from email_service import is_valid_email, send_email

    link = (cert.link_url or "").strip()
    title = "Новогодний подарок"
    if link:
        message = (
            "Твой новогодний подарок готов! Сохрани ссылку — она всегда будет в уведомлениях.\n"
            f"[code]{link}[/code]"
        )
        tg_text = (
            "🎁 <b>Твой новогодний подарок</b>\n\n"
            f"Ссылка на сертификат:\n{link}"
        )
        mail_text = f"Твой новогодний подарок готов.\n\nСсылка: {link}\n"
        mail_html = (
            "<p>Твой новогодний подарок готов.</p>"
            f'<p><a href="{link}">Открыть сертификат</a></p>'
            f"<p style=\"word-break:break-all\">{link}</p>"
        )
    else:
        message = "Твой новогодний подарок готов! Открой раздел «Новогодний подарок» в приложении."
        tg_text = "🎁 Твой новогодний подарок готов! Открой его в приложении «Спасибо»."
        mail_text = tg_text
        mail_html = f"<p>{tg_text}</p>"

    try:
        await crud._create_notification(
            db,
            user.id,
            "ny_gift",
            title,
            message,
            click_url="/?open=ny_gift",
            push_tag=f"ny-gift-{cert.id}",
        )
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("NY gift notification failed for user %s: %s", user.id, exc)

    telegram_id = getattr(user, "telegram_id", None)
    if isinstance(telegram_id, int) and telegram_id > 0:
        try:
            await send_telegram_message(telegram_id, tg_text)
        except Exception as exc:  # noqa: BLE001
            logger.warning("NY gift telegram failed for user %s: %s", user.id, exc)

    email = (getattr(user, "email", None) or "").strip()
    if email and is_valid_email(email):
        try:
            await send_email(
                to_email=email,
                subject="Твой новогодний подарок — Спасибо",
                body_html=mail_html,
                body_text=mail_text,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("NY gift email failed for user %s: %s", user.id, exc)


async def get_my_gift(db: AsyncSession, user: models.User) -> dict[str, Any]:
    """Возвращает выданный подарок текущего пользователя."""
    cert = await _fetch_certificate_for_user(db, user.id)
    if cert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок ещё не получен")
    return serialize_gift(cert)


async def load_object_for_owner(
    db: AsyncSession,
    user: models.User,
    *,
    kind: str,
) -> tuple[bytes, str]:
    """Читает байты файла подарка владельца."""
    cert = await _fetch_certificate_for_user(db, user.id)
    if cert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Подарок не найден")
    if kind == "thumb" and cert.thumb_key:
        key = cert.thumb_key
        content_type = "image/jpeg"
    else:
        key = cert.image_key
        content_type = cert.content_type or "image/jpeg"
    try:
        data = download_object_bytes(key)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail="Файл не найден") from exc
    return data, content_type


def _seeded_shuffle(items: list[Any], seed: str) -> list[Any]:
    rng = random.Random(seed)
    copy = list(items)
    rng.shuffle(copy)
    return copy


async def list_wall(
    db: AsyncSession,
    user: models.User,
    *,
    cursor: int = 0,
    limit: int = 48,
    seed: str | None = None,
) -> dict[str, Any]:
    """Страница стены фото со стабильным shuffle по seed сессии."""
    limit = max(1, min(limit, 200))
    cursor = max(0, cursor)
    settings = await get_or_create_settings(db)
    moderation = settings.photo_moderation_required

    query: Select[tuple[models.NyParticipant]] = select(models.NyParticipant).where(
        models.NyParticipant.photo_status == "visible"
    )
    if moderation:
        # Скрытые модератором уже отфильтрованы; свои фото показываем всегда.
        pass

    result = await db.execute(query.order_by(models.NyParticipant.id.asc()))
    rows = list(result.scalars().all())

    # Добавляем своё фото даже если оно hidden (модерация).
    mine = await get_participant(db, user.id)
    if mine and all(p.user_id != user.id for p in rows):
        rows.append(mine)

    session_seed = (seed or f"u{user.id}").strip() or f"u{user.id}"
    shuffled = _seeded_shuffle(rows, session_seed)
    page = shuffled[cursor : cursor + limit]
    next_cursor = cursor + len(page)
    has_more = next_cursor < len(shuffled)

    items = []
    for participant in page:
        author = participant.user
        items.append(
            {
                "user_id": participant.user_id,
                "display_name": "Вы" if participant.user_id == user.id else _display_name(author),
                "is_me": participant.user_id == user.id,
                "thumb_url": f"/ny/wall/{participant.user_id}/thumb",
                "photo_url": f"/ny/wall/{participant.user_id}/photo",
                "photo_uploaded_at": participant.photo_uploaded_at,
            }
        )
    return {
        "items": items,
        "cursor": next_cursor if has_more else None,
        "has_more": has_more,
        "seed": session_seed,
        "total": len(shuffled),
    }


async def load_wall_photo(
    db: AsyncSession,
    requester: models.User,
    target_user_id: int,
    *,
    thumb: bool,
) -> tuple[bytes, str]:
    """Отдаёт фото участника со стены (видимое или своё)."""
    participant = await get_participant(db, target_user_id)
    if participant is None:
        raise HTTPException(status_code=404, detail="Фото не найдено")
    is_owner = requester.id == target_user_id
    is_admin = bool(getattr(requester, "is_admin", False))
    if participant.photo_status != "visible" and not is_owner and not is_admin:
        raise HTTPException(status_code=404, detail="Фото не найдено")
    key = (
        participant.photo_thumb_key
        if thumb and participant.photo_thumb_key
        else participant.photo_key
    )
    try:
        data = download_object_bytes(key)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail="Файл не найден") from exc
    return data, "image/jpeg"


async def update_settings(
    db: AsyncSession,
    admin: models.User,
    payload: dict[str, Any],
) -> models.NyEventSettings:
    """Обновляет настройки ивента."""
    settings = await get_or_create_settings(db)
    for field in (
        "is_active",
        "starts_at",
        "ends_at",
        "taps_required",
        "photo_moderation_required",
        "low_stock_threshold",
    ):
        if field not in payload:
            continue
        value = payload[field]
        if field in {"starts_at", "ends_at"}:
            # null сбрасывает дату; aware ISO из фронта → naive UTC под колонку БД.
            setattr(settings, field, None if value is None else _as_naive_utc(value))
            continue
        if value is not None:
            setattr(settings, field, value)
    if settings.taps_required < 1:
        settings.taps_required = 1
    if settings.low_stock_threshold < 0:
        settings.low_stock_threshold = 0
    settings.updated_at = _utcnow()
    await _write_log(
        db,
        user_id=admin.id if admin.id > 0 else None,
        event_type="admin_action",
        payload={"action": "update_settings", "data": _json_safe(payload)},
    )
    await db.commit()
    await db.refresh(settings)
    return settings


async def create_certificates_batch(
    db: AsyncSession,
    admin: models.User,
    *,
    files: list[UploadFile],
    links_by_name: dict[str, dict[str, str]],
    comment: str | None = None,
) -> dict[str, Any]:
    """Загружает пакет сертификатов; ссылка необязательна (можно дописать позже)."""
    if not is_object_storage_configured():
        raise HTTPException(status_code=503, detail="Хранилище файлов не настроено")

    if not files:
        raise HTTPException(status_code=400, detail="Не переданы файлы сертификатов")

    expanded: list[tuple[str, bytes]] = []
    for upload in files:
        name = (upload.filename or "file").strip()
        raw = await upload.read()
        if not raw:
            continue
        if name.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                    for info in zf.infolist():
                        if info.is_dir():
                            continue
                        base = info.filename.split("/")[-1]
                        if not allowed_certificate_ext(base):
                            continue
                        expanded.append((base, zf.read(info)))
            except zipfile.BadZipFile as exc:
                raise HTTPException(status_code=400, detail=f"Некорректный ZIP: {name}") from exc
        else:
            expanded.append((name, raw))

    errors: list[dict[str, str]] = []
    prepared: list[dict[str, Any]] = []
    if not expanded:
        return {
            "created": 0,
            "errors": [{"file_name": "-", "error": "Файлы пустые или не переданы"}],
            "batch_id": None,
            "message": "Нет корректных файлов для загрузки",
        }
    seen_hashes: set[str] = set()
    seen_links: set[str] = set()
    existing_hashes = {
        row[0]
        for row in (
            await db.execute(
                select(models.NyCertificate.image_hash).where(
                    models.NyCertificate.image_hash.is_not(None)
                )
            )
        ).all()
        if row[0]
    }
    existing_links = {
        row[0]
        for row in (await db.execute(select(models.NyCertificate.link_url))).all()
        if row[0]
    }

    for filename, raw in expanded:
        meta = lookup_link_meta(links_by_name, filename)
        link, title = _resolve_certificate_link_and_title(
            meta_link=(meta.get("link") or meta.get("link_url") or ""),
            meta_title=(meta.get("title") or ""),
        )
        nominal = (meta.get("nominal") or "").strip() or None

        if link and (link in seen_links or link in existing_links):
            errors.append({"file_name": filename, "error": "Дубль ссылки — файл пропущен"})
            continue

        try:
            asset = prepare_certificate_asset(raw, filename)
        except ValueError as exc:
            errors.append({"file_name": filename, "error": str(exc)})
            continue

        digest = asset["digest"]
        if digest in seen_hashes or digest in existing_hashes:
            errors.append({"file_name": filename, "error": "Дубль файла"})
            continue

        seen_hashes.add(digest)
        if link:
            seen_links.add(link)

        prepared.append(
            {
                "file_name": filename,
                "full_bytes": asset["full_bytes"],
                "thumb_bytes": asset["thumb_bytes"],
                "digest": digest,
                "link": link,
                "nominal": nominal,
                "title": title,
                "content_type": asset["content_type"],
                "extension": asset["extension"],
            }
        )

    if not prepared:
        sample = "; ".join(f"{e['file_name']}: {e['error']}" for e in errors[:5]) or "файлы не распознаны"
        return {
            "created": 0,
            "errors": errors,
            "batch_id": None,
            "message": f"Нет корректных файлов для загрузки ({sample})",
        }

    batch = models.NyCertificateBatch(
        created_by=admin.id if admin.id > 0 else None,
        files_count=0,
        comment=comment,
    )
    db.add(batch)
    await db.flush()

    created = 0
    auto_linked = 0
    for item in prepared:
        try:
            image_key, thumb_key, file_url = await _upload_certificate_pair(
                filename=item["file_name"],
                full_bytes=item["full_bytes"],
                thumb_bytes=item["thumb_bytes"],
                full_ext=item["extension"],
                full_content_type=item["content_type"],
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("NY certificate S3 upload failed for %s", item["file_name"])
            errors.append({"file_name": item["file_name"], "error": f"Ошибка S3: {exc}"})
            continue

        link_url = item["link"] or file_url
        if not item["link"]:
            if link_url in seen_links or link_url in existing_links:
                errors.append(
                    {
                        "file_name": item["file_name"],
                        "error": "Дубль автоссылки на файл — пропущен",
                    }
                )
                delete_object_key(image_key)
                delete_object_key(thumb_key)
                continue
            seen_links.add(link_url)
            auto_linked += 1

        db.add(
            models.NyCertificate(
                batch_id=batch.id,
                image_key=image_key,
                thumb_key=thumb_key,
                link_url=link_url,
                nominal=item["nominal"],
                title=item["title"],
                status="available",
                image_hash=item["digest"],
                content_type=item["content_type"],
                original_filename=item["file_name"],
                created_by=admin.id if admin.id > 0 else None,
            )
        )
        created += 1

    batch.files_count = created
    await _write_log(
        db,
        user_id=admin.id if admin.id > 0 else None,
        event_type="admin_action",
        payload={"action": "upload_certificates", "batch_id": batch.id, "created": created},
    )
    await db.commit()
    extra = ""
    if auto_linked and created:
        extra = f" Ссылка на файл в S3 проставлена автоматически: {auto_linked}."
    return {
        "created": created,
        "errors": errors,
        "batch_id": batch.id,
        "message": f"Загружено {created}, с ошибками {len(errors)}.{extra}",
    }


async def list_certificates(
    db: AsyncSession,
    *,
    status_filter: str | None = None,
    batch_id: int | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    page = max(1, page)
    page_size = max(1, min(page_size, 100))
    query = select(models.NyCertificate)
    if status_filter:
        query = query.where(models.NyCertificate.status == status_filter)
    if batch_id:
        query = query.where(models.NyCertificate.batch_id == batch_id)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            or_(
                models.NyCertificate.link_url.ilike(like),
                models.NyCertificate.title.ilike(like),
                models.NyCertificate.nominal.ilike(like),
            )
        )
    total = int(
        (
            await db.execute(select(func.count()).select_from(query.subquery()))
        ).scalar_one()
        or 0
    )
    rows = (
        await db.execute(
            query.order_by(models.NyCertificate.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    items = []
    for cert in rows:
        issued_name = None
        if cert.issued_to_user_id and cert.issued_to_user:
            issued_name = _display_name(cert.issued_to_user)
        items.append(
            {
                "id": cert.id,
                "batch_id": cert.batch_id,
                "status": cert.status,
                "link_url": cert.link_url,
                "file_url": build_public_url(cert.image_key) if cert.image_key else "",
                "original_filename": cert.original_filename,
                "nominal": cert.nominal,
                "title": cert.title,
                "issued_to_user_id": cert.issued_to_user_id,
                "issued_to_name": issued_name,
                "issued_at": cert.issued_at,
                "created_at": cert.created_at,
                "thumb_url": f"/admin/ny/certificates/{cert.id}/thumb",
            }
        )
    return {"items": items, "page": page, "page_size": page_size, "total": total}


async def patch_certificate(
    db: AsyncSession,
    admin: models.User,
    cert_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    cert = await db.get(models.NyCertificate, cert_id)
    if cert is None:
        raise HTTPException(status_code=404, detail="Сертификат не найден")
    if cert.status == "issued" and any(k in payload for k in ("link_url", "status", "nominal", "title")):
        # Выданный: только nominal/title можно править; статус/ссылку — нет без аннулирования.
        if "link_url" in payload or payload.get("status") in {"available", "disabled"}:
            raise HTTPException(
                status_code=400,
                detail="Выданный сертификат нельзя изменить так. Используйте аннулирование.",
            )
    if "link_url" in payload and payload["link_url"] is not None:
        link = str(payload["link_url"]).strip()
        if link and not _is_valid_http_url(link):
            raise HTTPException(status_code=400, detail="Невалидный URL")
        cert.link_url = link or None
        # После добавления ссылки можно сразу сделать доступным.
        if cert.link_url and cert.status == "disabled":
            cert.status = "available"
    if "nominal" in payload:
        cert.nominal = (payload["nominal"] or None)
    if "title" in payload:
        cert.title = (payload["title"] or None)
    if "status" in payload and payload["status"] in {"available", "disabled"}:
        if cert.status == "issued":
            raise HTTPException(status_code=400, detail="Нельзя сменить статус выданного сертификата")
        if payload["status"] == "available" and not (cert.link_url or "").strip():
            raise HTTPException(status_code=400, detail="Сначала укажите ссылку сертификата")
        cert.status = payload["status"]
    if payload.get("action") == "revoke" and cert.status == "issued":
        cert.status = "disabled"
        cert.issued_to_user_id = None
        cert.issued_at = None
        # Отвязываем участника, но фото оставляем.
        result = await db.execute(
            select(models.NyParticipant).where(models.NyParticipant.certificate_id == cert.id)
        )
        participant = result.scalar_one_or_none()
        if participant:
            participant.certificate_id = None
            participant.gift_opened_at = None
    await _write_log(
        db,
        user_id=admin.id if admin.id > 0 else None,
        event_type="admin_action",
        payload={"action": "patch_certificate", "id": cert_id, "data": payload},
    )
    await db.commit()
    return {"ok": True, "id": cert.id, "status": cert.status}


async def delete_certificate(db: AsyncSession, admin: models.User, cert_id: int) -> dict[str, Any]:
    cert = await db.get(models.NyCertificate, cert_id)
    if cert is None:
        raise HTTPException(status_code=404, detail="Сертификат не найден")
    if cert.status == "issued":
        raise HTTPException(status_code=400, detail="Нельзя удалить выданный сертификат")
    keys = [cert.image_key, cert.thumb_key or ""]
    await db.delete(cert)
    await _write_log(
        db,
        user_id=admin.id if admin.id > 0 else None,
        event_type="admin_action",
        payload={"action": "delete_certificate", "id": cert_id},
    )
    await db.commit()
    for key in keys:
        if key:
            delete_object_key(key)
    return {"ok": True}


async def delete_batch(db: AsyncSession, admin: models.User, batch_id: int) -> dict[str, Any]:
    result = await db.execute(
        select(models.NyCertificate).where(models.NyCertificate.batch_id == batch_id)
    )
    certs = list(result.scalars().all())
    if any(c.status == "issued" for c in certs):
        raise HTTPException(status_code=400, detail="В пакете есть выданные сертификаты")
    for cert in certs:
        await db.delete(cert)
    batch = await db.get(models.NyCertificateBatch, batch_id)
    if batch:
        await db.delete(batch)
    await _write_log(
        db,
        user_id=admin.id if admin.id > 0 else None,
        event_type="admin_action",
        payload={"action": "delete_batch", "batch_id": batch_id, "count": len(certs)},
    )
    await db.commit()
    for cert in certs:
        delete_object_key(cert.image_key)
        if cert.thumb_key:
            delete_object_key(cert.thumb_key)
    return {"ok": True, "deleted": len(certs)}


async def get_stats(db: AsyncSession) -> dict[str, Any]:
    settings = await get_or_create_settings(db)
    total = int(
        (await db.execute(select(func.count()).select_from(models.NyCertificate))).scalar_one() or 0
    )
    issued = int(
        (
            await db.execute(
                select(func.count())
                .select_from(models.NyCertificate)
                .where(models.NyCertificate.status == "issued")
            )
        ).scalar_one()
        or 0
    )
    available = int(
        (
            await db.execute(
                select(func.count())
                .select_from(models.NyCertificate)
                .where(models.NyCertificate.status == "available")
            )
        ).scalar_one()
        or 0
    )
    open_screen = int(
        (
            await db.execute(
                select(func.count())
                .select_from(models.NyEventLog)
                .where(models.NyEventLog.event_type == "open_screen")
            )
        ).scalar_one()
        or 0
    )
    photos = int(
        (await db.execute(select(func.count()).select_from(models.NyParticipant))).scalar_one() or 0
    )
    gifts = int(
        (
            await db.execute(
                select(func.count())
                .select_from(models.NyParticipant)
                .where(models.NyParticipant.gift_opened_at.is_not(None))
            )
        ).scalar_one()
        or 0
    )
    no_stock = int(
        (
            await db.execute(
                select(func.count())
                .select_from(models.NyEventLog)
                .where(models.NyEventLog.event_type == "no_stock")
            )
        ).scalar_one()
        or 0
    )

    by_day = (
        await db.execute(
            text(
                """
                SELECT DATE(photo_uploaded_at) AS d, COUNT(*) AS c
                FROM ny_participants
                GROUP BY DATE(photo_uploaded_at)
                ORDER BY d
                """
            )
        )
    ).all()

    by_hour = (
        await db.execute(
            text(
                """
                SELECT EXTRACT(HOUR FROM photo_uploaded_at)::int AS h, COUNT(*) AS c
                FROM ny_participants
                GROUP BY 1
                ORDER BY 1
                """
            )
        )
    ).all()

    by_nominal = (
        await db.execute(
            text(
                """
                SELECT COALESCE(nominal, '—') AS n,
                       COUNT(*) FILTER (WHERE status = 'issued') AS issued,
                       COUNT(*) FILTER (WHERE status = 'available') AS available
                FROM ny_certificates
                GROUP BY 1
                ORDER BY 1
                """
            )
        )
    ).all()

    by_department = (
        await db.execute(
            text(
                """
                SELECT COALESCE(u.department, '—') AS dept, COUNT(*) AS c
                FROM ny_participants p
                JOIN users u ON u.id = p.user_id
                GROUP BY 1
                ORDER BY c DESC
                """
            )
        )
    ).all()

    recipients = (
        await db.execute(
            select(models.NyCertificate, models.User, models.NyParticipant)
            .join(models.User, models.User.id == models.NyCertificate.issued_to_user_id)
            .outerjoin(
                models.NyParticipant,
                models.NyParticipant.certificate_id == models.NyCertificate.id,
            )
            .where(models.NyCertificate.status == "issued")
            .order_by(models.NyCertificate.issued_at.desc())
            .limit(500)
        )
    ).all()

    return {
        "totals": {
            "certificates": total,
            "issued": issued,
            "available": available,
            "issued_percent": round((issued / total) * 100, 1) if total else 0,
            "low_stock": available < settings.low_stock_threshold,
            "low_stock_threshold": settings.low_stock_threshold,
        },
        "funnel": {
            "open_screen": open_screen,
            "photo_uploaded": photos,
            "gift_opened": gifts,
        },
        "no_stock_count": no_stock,
        "by_day": [{"date": str(r[0]), "count": int(r[1])} for r in by_day],
        "by_hour": [{"hour": int(r[0]), "count": int(r[1])} for r in by_hour],
        "by_nominal": [
            {"nominal": r[0], "issued": int(r[1]), "available": int(r[2])} for r in by_nominal
        ],
        "by_department": [{"department": r[0], "count": int(r[1])} for r in by_department],
        "recipients": [
            {
                "user_id": user.id,
                "name": _display_name(user),
                "department": user.department,
                "issued_at": cert.issued_at,
                "nominal": cert.nominal,
                "certificate_id": cert.id,
                "has_photo": participant is not None,
            }
            for cert, user, participant in recipients
        ],
    }


async def export_stats_csv(db: AsyncSession) -> str:
    stats = await get_stats(db)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["user_id", "name", "department", "issued_at", "nominal", "certificate_id"])
    for row in stats["recipients"]:
        writer.writerow(
            [
                row["user_id"],
                row["name"],
                row["department"],
                row["issued_at"],
                row["nominal"] or "",
                row["certificate_id"],
            ]
        )
    return buf.getvalue()


async def list_photos_admin(db: AsyncSession) -> list[dict[str, Any]]:
    result = await db.execute(
        select(models.NyParticipant).order_by(models.NyParticipant.photo_uploaded_at.desc())
    )
    rows = result.scalars().all()
    items = []
    for p in rows:
        items.append(
            {
                "user_id": p.user_id,
                "name": _display_name(p.user),
                "photo_status": p.photo_status,
                "photo_uploaded_at": p.photo_uploaded_at,
                "gift_opened": bool(p.gift_opened_at),
                "thumb_url": f"/admin/ny/photos/{p.user_id}/thumb",
            }
        )
    return items


async def set_photo_visibility(
    db: AsyncSession,
    admin: models.User,
    user_id: int,
    *,
    visible: bool,
) -> dict[str, Any]:
    participant = await get_participant(db, user_id)
    if participant is None:
        raise HTTPException(status_code=404, detail="Фото не найдено")
    participant.photo_status = "visible" if visible else "hidden"
    await _write_log(
        db,
        user_id=admin.id if admin.id > 0 else None,
        event_type="admin_action",
        payload={"action": "photo_visibility", "user_id": user_id, "visible": visible},
    )
    await db.commit()
    return {"ok": True, "user_id": user_id, "photo_status": participant.photo_status}


async def load_admin_certificate_image(db: AsyncSession, cert_id: int, *, thumb: bool) -> tuple[bytes, str]:
    cert = await db.get(models.NyCertificate, cert_id)
    if cert is None:
        raise HTTPException(status_code=404, detail="Сертификат не найден")
    key = cert.thumb_key if thumb and cert.thumb_key else cert.image_key
    try:
        data = download_object_bytes(key)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail="Файл не найден") from exc
    return data, "image/jpeg"


_NAME_HEADERS = {
    "file_name",
    "filename",
    "file",
    "name",
    "image",
    "img",
    "файл",
    "имя файла",
    "имя",
    "картинка",
    "фото",
}
_LINK_HEADERS = {
    "link",
    "link_url",
    "url",
    "href",
    "ссылка",
    "url ссылка",
}
_NOMINAL_HEADERS = {"nominal", "amount", "value", "номинал", "сумма"}
_TITLE_HEADERS = {"title", "name_title", "название", "заголовок"}


def _normalize_header(value: str | None) -> str:
    return " ".join(str(value or "").replace("\ufeff", "").strip().lower().split())


def _basename_key(name: str) -> str:
    """Имя файла без пути, в нижнем регистре."""
    cleaned = (name or "").replace("\\", "/").strip().strip('"').strip("'")
    base = cleaned.split("/")[-1].strip()
    return base.lower()


def _stem_key(name: str) -> str:
    """Имя без расширения."""
    base = _basename_key(name)
    if "." in base:
        return base.rsplit(".", 1)[0]
    return base


def _row_get(row: dict[str, Any], aliases: set[str]) -> str:
    for key, value in row.items():
        if _normalize_header(key) in aliases:
            return str(value or "").strip()
    return ""


def _put_link_aliases(mapping: dict[str, dict[str, str]], file_name: str, meta: dict[str, str]) -> None:
    """Кладёт meta под несколькими ключами имени файла для fuzzy-match."""
    raw = (file_name or "").strip().strip('"').strip("'")
    if not raw:
        return
    keys = {
        raw,
        raw.lower(),
        _basename_key(raw),
        _stem_key(raw),
    }
    # Иногда в CSV пишут имя без расширения, а файл — с .jpg
    for key in keys:
        if key:
            mapping[key] = meta


def lookup_link_meta(
    links_by_name: dict[str, dict[str, str]],
    filename: str,
) -> dict[str, str]:
    """Ищет ссылку по точному имени, basename или stem без расширения."""
    candidates = [
        filename,
        filename.lower(),
        _basename_key(filename),
        _stem_key(filename),
    ]
    for key in candidates:
        meta = links_by_name.get(key)
        if meta and (meta.get("link") or meta.get("link_url")):
            return meta
    # Перебор: stem CSV == stem файла
    file_stem = _stem_key(filename)
    for key, meta in links_by_name.items():
        if _stem_key(key) == file_stem and (meta.get("link") or meta.get("link_url")):
            return meta
    return {}


def _mapping_from_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    mapping: dict[str, dict[str, str]] = {}
    for row in rows:
        name = _row_get(row, _NAME_HEADERS)
        link = _row_get(row, _LINK_HEADERS)
        if not name and not link:
            # Fallback: первая колонка = файл, вторая = ссылка
            values = [str(v or "").strip() for v in row.values()]
            if len(values) >= 2:
                name, link = values[0], values[1]
        if not name:
            continue
        meta = {
            "link": link,
            "nominal": _row_get(row, _NOMINAL_HEADERS),
            "title": _row_get(row, _TITLE_HEADERS),
        }
        _put_link_aliases(mapping, name, meta)
    return mapping


def parse_links_csv(raw: bytes) -> dict[str, dict[str, str]]:
    """Парсит CSV (`,` или `;`) с колонками файла и ссылки."""
    text_data = raw.decode("utf-8-sig", errors="replace").strip()
    if not text_data:
        return {}
    # Excel в RU часто сохраняет CSV с разделителем `;`.
    sample = text_data[:4096]
    delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text_data), delimiter=delimiter)
    if not reader.fieldnames:
        return {}
    rows = [dict(row) for row in reader]
    return _mapping_from_rows(rows)


def parse_links_table_file(filename: str, raw: bytes) -> dict[str, dict[str, str]]:
    """Парсит CSV или XLSX со ссылками сертификатов."""
    lower = (filename or "").lower()
    if lower.endswith(".xlsx") or lower.endswith(".xlsm"):
        try:
            from openpyxl import load_workbook
        except ImportError as exc:
            raise HTTPException(
                status_code=400,
                detail="Для XLSX нужен openpyxl на сервере",
            ) from exc
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        try:
            header = next(rows_iter)
        except StopIteration:
            return {}
        headers = [str(cell or "").strip() for cell in header]
        rows: list[dict[str, Any]] = []
        for values in rows_iter:
            row = {
                headers[i]: ("" if values[i] is None else str(values[i]).strip())
                for i in range(len(headers))
            }
            rows.append(row)
        return _mapping_from_rows(rows)
    return parse_links_csv(raw)
