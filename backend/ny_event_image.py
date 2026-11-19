"""Обработка изображений и PDF новогоднего ивента."""

from __future__ import annotations

import hashlib
import io
from typing import Final

import pillow_avif  # noqa: F401
from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError

from image_avif import _normalize_mode

_MAX_UPLOAD_BYTES: Final[int] = 12 * 1024 * 1024
_PHOTO_MAX_SIDE: Final[int] = 1600
_THUMB_MAX_SIDE: Final[int] = 256
_CERT_MAX_SIDE: Final[int] = 1600
_JPEG_QUALITY: Final[int] = 80

_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
_PDF_EXT = {".pdf"}
_ALLOWED_CERT_EXT = _IMAGE_EXT | _PDF_EXT


def allowed_certificate_ext(filename: str) -> str:
    """Возвращает расширение сертификата или пустую строку."""
    lower = (filename or "").lower().strip()
    for ext in sorted(_ALLOWED_CERT_EXT, key=len, reverse=True):
        if lower.endswith(ext):
            return ext
    return ""


def _open_image(raw: bytes) -> Image.Image:
    """Открывает изображение из байтов с проверками."""
    if not raw:
        raise ValueError("Пустой файл")
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise ValueError("Файл слишком большой (максимум 12 МБ)")
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
    # JPEG не умеет альфу — RGBA/LA/P с прозрачностью сводим к RGB.
    if img.mode not in {"RGB", "L"}:
        if img.mode in {"RGBA", "LA"} or (img.mode == "P" and "transparency" in img.info):
            rgba = img.convert("RGBA")
            background = Image.new("RGB", rgba.size, (255, 255, 255))
            background.paste(rgba, mask=rgba.split()[-1])
            img = background
        else:
            img = img.convert("RGB")
    elif img.mode == "L":
        img = img.convert("RGB")
    img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=quality, optimize=True)
    return out.getvalue()


def encode_participant_photo(raw: bytes) -> tuple[bytes, bytes]:
    """Возвращает (full JPEG, thumb JPEG) для фото участника."""
    full = encode_jpeg(raw, max_side=_PHOTO_MAX_SIDE, quality=_JPEG_QUALITY)
    thumb = encode_jpeg(raw, max_side=_THUMB_MAX_SIDE, quality=75)
    return full, thumb


def _pdf_placeholder_thumb() -> bytes:
    """Простая JPEG-заглушка для PDF-сертификата."""
    img = Image.new("RGB", (256, 320), "#f4f0e6")
    draw = ImageDraw.Draw(img)
    draw.rectangle((24, 24, 232, 296), outline="#c0392b", width=4)
    draw.text((88, 140), "PDF", fill="#c0392b")
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=80)
    return out.getvalue()


def _is_pdf(raw: bytes, filename: str) -> bool:
    if raw[:4] == b"%PDF":
        return True
    return allowed_certificate_ext(filename) == ".pdf"


def prepare_certificate_asset(raw: bytes, filename: str) -> dict:
    """Готовит файл сертификата к сохранению (картинка или PDF).

    Returns:
        dict с full_bytes, thumb_bytes, digest, content_type, extension.
    """
    if not raw:
        raise ValueError("Пустой файл")
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise ValueError("Файл слишком большой (максимум 12 МБ)")

    ext = allowed_certificate_ext(filename)
    if _is_pdf(raw, filename):
        if not ext:
            ext = ".pdf"
        digest = hashlib.sha256(raw).hexdigest()
        return {
            "full_bytes": raw,
            "thumb_bytes": _pdf_placeholder_thumb(),
            "digest": digest,
            "content_type": "application/pdf",
            "extension": "pdf",
        }

    if not ext or ext not in _IMAGE_EXT:
        # Пробуем как картинку по содержимому (без расширения / странное имя).
        try:
            full = encode_jpeg(raw, max_side=_CERT_MAX_SIDE, quality=85)
            thumb = encode_jpeg(raw, max_side=_THUMB_MAX_SIDE, quality=75)
        except ValueError as exc:
            raise ValueError(
                "Поддерживаются JPG, PNG, WEBP, GIF и PDF"
            ) from exc
        digest = hashlib.sha256(full).hexdigest()
        return {
            "full_bytes": full,
            "thumb_bytes": thumb,
            "digest": digest,
            "content_type": "image/jpeg",
            "extension": "jpg",
        }

    full = encode_jpeg(raw, max_side=_CERT_MAX_SIDE, quality=85)
    thumb = encode_jpeg(raw, max_side=_THUMB_MAX_SIDE, quality=75)
    digest = hashlib.sha256(full).hexdigest()
    return {
        "full_bytes": full,
        "thumb_bytes": thumb,
        "digest": digest,
        "content_type": "image/jpeg",
        "extension": "jpg",
    }


def encode_certificate_image(raw: bytes) -> tuple[bytes, bytes, str]:
    """Совместимость: только картинки → JPEG + hash."""
    prepared = prepare_certificate_asset(raw, "cert.jpg")
    return prepared["full_bytes"], prepared["thumb_bytes"], prepared["digest"]
