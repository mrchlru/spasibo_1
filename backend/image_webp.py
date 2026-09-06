"""Конвертация изображений в WebP для аватаров."""

import io
from typing import Final

import pillow_avif  # noqa: F401 — декодирование AVIF в Pillow
from PIL import Image, ImageOps, UnidentifiedImageError

from image_avif import _normalize_mode

_AVATAR_MAX_UPLOAD_BYTES: Final[int] = 8 * 1024 * 1024


def encode_image_bytes_to_webp(
    raw: bytes,
    *,
    max_side: int,
    quality: int,
) -> bytes:
    """Декодирует изображение и сохраняет в WebP с ограничением по длинной стороне.

    Args:
        raw: Исходные байты файла.
        max_side: Максимум длинной стороны в пикселях.
        quality: Качество WebP (0–100).

    Returns:
        Байты WebP.

    Raises:
        ValueError: Пустой файл, слишком большой файл или неподдерживаемый формат.
    """
    if not raw:
        raise ValueError("Пустой файл")
    if len(raw) > _AVATAR_MAX_UPLOAD_BYTES:
        limit_mb = _AVATAR_MAX_UPLOAD_BYTES // (1024 * 1024)
        raise ValueError(f"Файл слишком большой (максимум {limit_mb} МБ)")
    try:
        img = Image.open(io.BytesIO(raw))
    except UnidentifiedImageError as exc:
        raise ValueError("Не удалось распознать изображение") from exc

    img = ImageOps.exif_transpose(img)
    if getattr(img, "n_frames", 1) > 1:
        img.seek(0)
    img = _normalize_mode(img)
    img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

    out = io.BytesIO()
    img.save(out, format="WEBP", quality=quality, method=6)
    return out.getvalue()
