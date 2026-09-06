"""Утилиты для разграничения прав администраторов."""

from admin_panel_auth import parse_allowed_emails
from config import settings


def get_primary_admin_telegram_id() -> int | None:
    """Telegram ID главного админа — первый в ``TELEGRAM_ADMIN_IDS``."""
    raw = (settings.TELEGRAM_ADMIN_IDS or "").strip()
    if not raw:
        return None
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            return int(part)
        except ValueError:
            continue
    return None


def user_is_primary_admin(user: object) -> bool:
    """
    Главный админ:
    - вход в панель (synthetic id=-1);
    - первый ID из TELEGRAM_ADMIN_IDS;
    - is_admin с email из ADMIN_EMAILS (обычный вход на ПК).
    """
    user_id = getattr(user, "id", None)
    if user_id == -1:
        return True

    primary_id = get_primary_admin_telegram_id()
    telegram_id = getattr(user, "telegram_id", None)
    if primary_id is not None and telegram_id is not None and telegram_id == primary_id:
        return True

    if not getattr(user, "is_admin", False):
        return False

    email = (getattr(user, "email", None) or "").strip().lower()
    if email and email in parse_allowed_emails():
        return True

    return False
