"""Загрузка файлов в S3-совместимое хранилище (Timeweb Cloud и др.)."""

import logging
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

import boto3
from botocore.exceptions import ClientError

from config import settings

logger = logging.getLogger(__name__)


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

    parsed = urlparse(normalized)
    path = parsed.path.lstrip("/")
    if bucket and path.startswith(f"{bucket}/"):
        return path[len(bucket) + 1 :]
    return path or None


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


def upload_bytes(key: str, body: bytes, content_type: str) -> str:
    """Загружает байты в бакет и возвращает публичный URL.

    Raises:
        RuntimeError: Ошибка API хранилища.
    """
    session = boto3.session.Session()
    client = session.client(
        service_name="s3",
        endpoint_url=settings.S3_ENDPOINT_URL.strip(),
        aws_access_key_id=settings.S3_ACCESS_KEY_ID.strip(),
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY.strip(),
        region_name=settings.S3_REGION.strip() or "ru-1",
    )
    put_kwargs: dict[str, str | bytes] = {
        "Bucket": settings.S3_BUCKET.strip(),
        "Key": key,
        "Body": body,
        "ContentType": content_type,
        "CacheControl": "public, max-age=31536000",
    }
    acl = settings.S3_OBJECT_ACL.strip()
    if acl:
        put_kwargs["ACL"] = acl
    try:
        client.put_object(**put_kwargs)
    except ClientError as exc:
        raise RuntimeError(f"Ошибка загрузки в объектное хранилище: {exc}") from exc
    return build_public_url(key)
