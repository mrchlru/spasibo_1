"""Утилиты для разграничения прав администраторов."""

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
    Главный админ: первый ID из TELEGRAM_ADMIN_IDS или вход в панель (synthetic id=-1).
    """
    user_id = getattr(user, "id", None)
    if user_id == -1:
        return True
    primary_id = get_primary_admin_telegram_id()
    if primary_id is None:
        return False
    telegram_id = getattr(user, "telegram_id", None)
    return telegram_id is not None and telegram_id == primary_id
