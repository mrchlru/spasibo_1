"""Конвертация растровых изображений и SVG в AVIF для экономии трафика."""

import io
from typing import Final

import pillow_avif  # noqa: F401 — регистрация формата AVIF в Pillow
from PIL import Image, ImageOps, UnidentifiedImageError

_MAX_UPLOAD_BYTES: Final[int] = 15 * 1024 * 1024


def encode_image_bytes_to_avif(
    raw: bytes,
    *,
    max_side: int,
    quality: int,
) -> bytes:
    """Декодирует изображение и сохраняет в AVIF с ограничением по длинной стороне.

    Args:
        raw: Исходные байты файла (JPEG, PNG, WebP, SVG, GIF первый кадр и т.д.).
        max_side: Максимум длинной стороны в пикселях (пропорции сохраняются).
        quality: Качество AVIF (0–100).

    Returns:
        Байты AVIF.

    Raises:
        ValueError: Пустой файл, слишком большой файл или неподдерживаемый формат.
    """
    if not raw:
        raise ValueError("Пустой файл")
    if len(raw) > _MAX_UPLOAD_BYTES:
        limit_mb = _MAX_UPLOAD_BYTES // (1024 * 1024)
        raise ValueError(f"Файл слишком большой (максимум {limit_mb} МБ)")
    try:
        img = _open_image_bytes(raw)
    except UnidentifiedImageError as exc:
        raise ValueError("Не удалось распознать изображение") from exc
    img = ImageOps.exif_transpose(img)
    if getattr(img, "n_frames", 1) > 1:
        img.seek(0)
    img = _normalize_mode(img)
    img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="AVIF", quality=quality)
    return out.getvalue()


def _open_image_bytes(raw: bytes) -> Image.Image:
    """Открывает растровое изображение или конвертирует SVG в растр."""
    if _looks_like_svg(raw):
        return _rasterize_svg(raw)
    return Image.open(io.BytesIO(raw))


def _looks_like_svg(raw: bytes) -> bool:
    """Проверяет, похожи ли байты на SVG."""
    stripped = raw.lstrip()
    if not stripped.startswith(b"<"):
        return False
    head = stripped[:512].lower()
    return b"<svg" in head or stripped.startswith(b"<?xml")


def _rasterize_svg(raw: bytes) -> Image.Image:
    """Преобразует SVG в растровое изображение через cairosvg."""
    try:
        import cairosvg
    except ImportError as exc:
        raise ValueError(
            "SVG не поддерживается на сервере: установите пакет cairosvg и libcairo"
        ) from exc
    try:
        png_bytes = cairosvg.svg2png(bytestring=raw)
    except Exception as exc:
        raise ValueError("Не удалось конвертировать SVG") from exc
    if not png_bytes:
        raise ValueError("SVG дал пустой результат")
    return Image.open(io.BytesIO(png_bytes))


def _normalize_mode(img: Image.Image) -> Image.Image:
    """Приводит режим к RGB или RGBA для кодирования AVIF."""
    if img.mode in ("RGB", "RGBA"):
        return img
    if img.mode in ("P", "PA"):
        return img.convert("RGBA")
    if img.mode in ("L", "LA"):
        return img.convert("RGBA" if img.mode == "LA" else "RGB")
    if img.mode == "CMYK":
        return img.convert("RGB")
    return img.convert("RGB")
