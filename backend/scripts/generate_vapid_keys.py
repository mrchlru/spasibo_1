"""Генерация VAPID-ключей для Web Push (Timeweb / .env)."""

from __future__ import annotations

import base64

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid
from py_vapid.utils import b64urlencode


def main() -> None:
    """Печатает переменные окружения для push «Спасибо»."""
    vapid = Vapid()
    vapid.generate_keys()

    public_bytes = vapid.public_key.public_bytes(
        Encoding.X962,
        PublicFormat.UncompressedPoint,
    )
    public_key = b64urlencode(public_bytes)
    private_b64 = base64.urlsafe_b64encode(vapid.private_pem()).decode().rstrip("=")

    print("WEB_PUSH_ENABLED=true")
    print(f"VAPID_PUBLIC_KEY={public_key}")
    print(f"VAPID_PRIVATE_KEY={private_b64}")
    print("VAPID_CONTACT_EMAIL=mailto:admin@spasibo.local")
    print("PWA_PUBLIC_BASE_URL=https://your-app-domain.example")


if __name__ == "__main__":
    main()
