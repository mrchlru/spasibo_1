"""Сжатие призовых картинок в JPEG (для скачивания с устройств)."""

from __future__ import annotations

import io
from typing import Final

from PIL import Image, ImageOps, UnidentifiedImageError

from image_avif import _normalize_mode

_PRIZE_MAX_UPLOAD_BYTES: Final[int] = 12 * 1024 * 1024
_DEFAULT_MAX_SIDE: Final[int] = 1600
_DEFAULT_QUALITY: Final[int] = 82


def encode_prize_image_bytes_to_jpeg(
    raw: bytes,
    *,
    max_side: int = _DEFAULT_MAX_SIDE,
    quality: int = _DEFAULT_QUALITY,
) -> bytes:
    """Декодирует изображение и сохраняет в JPEG с ограничением длинной стороны.

    Args:
        raw: Исходные байты файла.
        max_side: Максимум длинной стороны в пикселях.
        quality: Качество JPEG (1–95).

    Returns:
        Байты JPEG.

    Raises:
        ValueError: Пустой файл, слишком большой файл или неподдерживаемый формат.
    """
    if not raw:
        raise ValueError("Пустой файл")
    if len(raw) > _PRIZE_MAX_UPLOAD_BYTES:
        limit_mb = _PRIZE_MAX_UPLOAD_BYTES // (1024 * 1024)
        raise ValueError(f"Файл слишком большой (максимум {limit_mb} МБ)")
    try:
        img = Image.open(io.BytesIO(raw))
    except UnidentifiedImageError as exc:
        raise ValueError("Не удалось распознать изображение") from exc

    img = ImageOps.exif_transpose(img)
    if getattr(img, "n_frames", 1) > 1:
        img.seek(0)
    img = _normalize_mode(img)
    if img.mode in ("RGBA", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        alpha = img.split()[-1]
        background.paste(img, mask=alpha)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=max(1, min(95, quality)), optimize=True)
    return out.getvalue()
