"""Обработка изображений новогоднего ивента (фото участников и сертификаты)."""

from __future__ import annotations

import hashlib
import io
from typing import Final

import pillow_avif  # noqa: F401
from PIL import Image, ImageOps, UnidentifiedImageError

from image_avif import _normalize_mode

_MAX_UPLOAD_BYTES: Final[int] = 8 * 1024 * 1024
_PHOTO_MAX_SIDE: Final[int] = 1600
_THUMB_MAX_SIDE: Final[int] = 256
_CERT_MAX_SIDE: Final[int] = 1600
_JPEG_QUALITY: Final[int] = 80


def _open_image(raw: bytes) -> Image.Image:
    """Открывает изображение из байтов с проверками."""
    if not raw:
        raise ValueError("Пустой файл")
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise ValueError("Файл слишком большой (максимум 8 МБ)")
    try:
        img = Image.open(io.BytesIO(raw))
    except UnidentifiedImageError as exc:
        raise ValueError("Не удалось распознать изображение") from exc
    img = ImageOps.exif_transpose(img)
    if getattr(img, "n_frames", 1) > 1:
        img.seek(0)
    return _normalize_mode(img)


def encode_jpeg(raw: bytes, *, max_side: int, quality: int = _JPEG_QUALITY) -> bytes:
    """Перекодирует картинку в JPEG без EXIF, ограничивая длинную сторону."""
    img = _open_image(raw)
    img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=quality, optimize=True)
    return out.getvalue()


def encode_participant_photo(raw: bytes) -> tuple[bytes, bytes]:
    """Возвращает (full JPEG, thumb JPEG) для фото участника."""
    full = encode_jpeg(raw, max_side=_PHOTO_MAX_SIDE, quality=_JPEG_QUALITY)
    thumb = encode_jpeg(raw, max_side=_THUMB_MAX_SIDE, quality=75)
    return full, thumb


def encode_certificate_image(raw: bytes) -> tuple[bytes, bytes, str]:
    """Возвращает (full JPEG, thumb JPEG, sha256 hex) для сертификата."""
    full = encode_jpeg(raw, max_side=_CERT_MAX_SIDE, quality=85)
    thumb = encode_jpeg(raw, max_side=_THUMB_MAX_SIDE, quality=75)
    digest = hashlib.sha256(full).hexdigest()
    return full, thumb, digest
