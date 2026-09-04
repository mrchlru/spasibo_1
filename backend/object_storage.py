"""Загрузка файлов в S3-совместимое хранилище (Timeweb Cloud и др.)."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote, urlparse

import boto3
from botocore.exceptions import ClientError

from config import settings

logger = logging.getLogger(__name__)

_PRIZE_ROOT = "market-prizes"

_CYRILLIC_TO_LATIN = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "",
    "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def slugify_prize_folder(name: str) -> str:
    """Нормализует название товара в безопасное имя папки S3."""
    text = (name or "").strip().lower()
    mapped = "".join(_CYRILLIC_TO_LATIN.get(ch, ch) for ch in text)
    mapped = re.sub(r"[^a-z0-9]+", "-", mapped)
    mapped = re.sub(r"-{2,}", "-", mapped).strip("-")
    return mapped[:80] or "item"


def generate_prize_object_key(folder_slug: str) -> str:
    """Уникальный ключ JPEG-приза в папке товара."""
    safe_slug = slugify_prize_folder(folder_slug)
    unique = uuid.uuid4().hex
    return f"{_PRIZE_ROOT}/{safe_slug}/{unique}.jpg"


def prize_folder_prefix(folder_slug: str) -> str:
    """Префикс ключей папки призов товара."""
    return f"{_PRIZE_ROOT}/{slugify_prize_folder(folder_slug)}/"


def is_prize_asset_url(url: str | None) -> bool:
    """Проверяет, что URL указывает на призовую картинку в S3."""
    if not url:
        return False
    return f"/{_PRIZE_ROOT}/" in url or url.startswith(f"{_PRIZE_ROOT}/")


def is_object_storage_configured() -> bool:
    """Возвращает True, если заданы параметры для загрузки в бакет."""
    return bool(
        settings.S3_BUCKET.strip()
        and settings.S3_ACCESS_KEY_ID.strip()
        and settings.S3_SECRET_ACCESS_KEY.strip()
    )


def build_public_url(key: str) -> str:
    """Собирает публичный URL объекта для отображения в интерфейсе."""
    base = settings.S3_PUBLIC_BASE_URL.strip().rstrip("/")
    if base:
        return f"{base}/{key}"
    bucket = settings.S3_BUCKET.strip()
    endpoint = settings.S3_ENDPOINT_URL.strip().rstrip("/")
    return f"{endpoint}/{bucket}/{key}"


def generate_media_object_key(prefix: str = "media", extension: str = "avif") -> str:
    """Уникальный ключ с префиксом по дате (UTC)."""
    now = datetime.now(timezone.utc)
    unique = uuid.uuid4().hex
    return f"{prefix}/{now:%Y/%m}/{unique}.{extension}"


def generate_avatar_object_key(user_id: int) -> str:
    """Ключ для аватара пользователя в S3."""
    unique = uuid.uuid4().hex
    return f"avatars/{user_id}/{unique}.webp"


def public_url_to_object_key(url: str) -> str | None:
    """Извлекает ключ объекта из публичного URL бакета."""
    normalized = (url or "").strip()
    if not normalized:
        return None

    public_base = settings.S3_PUBLIC_BASE_URL.strip().rstrip("/")
    if public_base and normalized.startswith(public_base + "/"):
        return normalized[len(public_base) + 1 :]

    bucket = settings.S3_BUCKET.strip()
    endpoint = settings.S3_ENDPOINT_URL.strip().rstrip("/")
    for prefix in (f"{endpoint}/{bucket}/", f"{endpoint}/{bucket}"):
        if normalized.startswith(prefix):
            suffix = normalized[len(prefix) :].lstrip("/")
            return suffix or None

    path = unquote(urlparse(normalized).path or "")
    for marker in ("/feed-posts/", "/market-prizes/", "/media/"):
        idx = path.find(marker)
        if idx >= 0:
            return path[idx + 1 :].lstrip("/") or None
    path = path.lstrip("/")
    if bucket and path.startswith(f"{bucket}/"):
        return path[len(bucket) + 1 :]
    return path or None


def _s3_client() -> Any:
    """Создаёт boto3 S3-клиент."""
    return boto3.session.Session().client(
        service_name="s3",
        endpoint_url=settings.S3_ENDPOINT_URL.strip(),
        aws_access_key_id=settings.S3_ACCESS_KEY_ID.strip(),
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY.strip(),
        region_name=settings.S3_REGION.strip() or "ru-1",
    )


def list_object_keys(prefix: str) -> list[str]:
    """Возвращает ключи объектов с заданным префиксом."""
    client = _s3_client()
    bucket = settings.S3_BUCKET.strip()
    keys: list[str] = []
    continuation: str | None = None
    while True:
        kwargs: dict[str, str | int] = {
            "Bucket": bucket,
            "Prefix": prefix,
            "MaxKeys": 1000,
        }
        if continuation:
            kwargs["ContinuationToken"] = continuation
        try:
            response = client.list_objects_v2(**kwargs)
        except ClientError as exc:
            raise RuntimeError(f"Ошибка списка объектов S3: {exc}") from exc
        for item in response.get("Contents") or []:
            key = item.get("Key")
            if isinstance(key, str) and key:
                keys.append(key)
        if not response.get("IsTruncated"):
            break
        continuation = response.get("NextContinuationToken")
    return keys


def rename_object_prefix(old_prefix: str, new_prefix: str) -> dict[str, str]:
    """Копирует объекты из old_prefix в new_prefix и удаляет старые."""
    if old_prefix == new_prefix:
        return {}
    client = _s3_client()
    bucket = settings.S3_BUCKET.strip()
    mapping: dict[str, str] = {}
    for old_key in list_object_keys(old_prefix):
        suffix = old_key[len(old_prefix):]
        new_key = f"{new_prefix}{suffix}"
        try:
            client.copy_object(
                Bucket=bucket,
                CopySource={"Bucket": bucket, "Key": old_key},
                Key=new_key,
                MetadataDirective="COPY",
            )
            client.delete_object(Bucket=bucket, Key=old_key)
        except ClientError as exc:
            raise RuntimeError(f"Ошибка переименования объекта S3: {exc}") from exc
        mapping[old_key] = new_key
    return mapping


def delete_object_key(key: str) -> bool:
    """Удаляет объект из бакета. Возвращает True при успехе."""
    normalized = (key or "").strip().lstrip("/")
    if not normalized:
        return False
    if not is_object_storage_configured():
        return False

    session = boto3.session.Session()
    client = session.client(
        service_name="s3",
        endpoint_url=settings.S3_ENDPOINT_URL.strip(),
        aws_access_key_id=settings.S3_ACCESS_KEY_ID.strip(),
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY.strip(),
        region_name=settings.S3_REGION.strip() or "ru-1",
    )
    bucket = settings.S3_BUCKET.strip()
    try:
        client.delete_object(Bucket=bucket, Key=normalized)
        return True
    except ClientError as exc:
        logger.warning("Не удалось удалить объект S3 %s: %s", normalized, exc)
        return False


def upload_bytes(
    key: str,
    body: bytes,
    content_type: str,
    *,
    content_disposition: str | None = None,
) -> str:
    """Загружает байты в бакет и возвращает публичный URL.

    Raises:
        RuntimeError: Ошибка API хранилища.
    """
    client = _s3_client()
    put_kwargs: dict[str, str | bytes] = {
        "Bucket": settings.S3_BUCKET.strip(),
        "Key": key,
        "Body": body,
        "ContentType": content_type,
        "CacheControl": "public, max-age=31536000",
    }
    if content_disposition:
        put_kwargs["ContentDisposition"] = content_disposition
    acl = settings.S3_OBJECT_ACL.strip()
    if acl:
        put_kwargs["ACL"] = acl
    try:
        client.put_object(**put_kwargs)
    except ClientError as exc:
        raise RuntimeError(f"Ошибка загрузки в объектное хранилище: {exc}") from exc
    return build_public_url(key)
