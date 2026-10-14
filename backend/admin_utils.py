"""Утилиты для разграничения прав администраторов."""

from admin_panel_auth import parse_allowed_emails
from config import settings


def _parse_telegram_admin_id_list() -> list[int]:
    """Telegram ID из ``TELEGRAM_ADMIN_IDS`` в порядке списка (без дублей)."""
    raw = (settings.TELEGRAM_ADMIN_IDS or "").strip()
    if not raw:
        return []
    ids: list[int] = []
    seen: set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            telegram_id = int(part)
        except ValueError:
            continue
        if telegram_id in seen:
            continue
        seen.add(telegram_id)
        ids.append(telegram_id)
    return ids


def parse_telegram_admin_ids() -> frozenset[int]:
    """Все Telegram ID из ``TELEGRAM_ADMIN_IDS`` (через запятую)."""
    return frozenset(_parse_telegram_admin_id_list())


def get_primary_admin_telegram_id() -> int | None:
    """Telegram ID главного админа — первый в ``TELEGRAM_ADMIN_IDS``."""
    ids = _parse_telegram_admin_id_list()
    return ids[0] if ids else None


def user_is_env_telegram_admin(user: object) -> bool:
    """Пользователь с Telegram ID из ``TELEGRAM_ADMIN_IDS``."""
    telegram_id = getattr(user, "telegram_id", None)
    if telegram_id is None:
        return False
    try:
        return int(telegram_id) in parse_telegram_admin_ids()
    except (TypeError, ValueError):
        return False


def user_can_grant_admin(user: object) -> bool:
    """
    Может включать/выключать ``is_admin`` у других:

    - вход в админ-панель по env (synthetic id=-1);
    - любой Telegram ID из ``TELEGRAM_ADMIN_IDS``.

    Обычные админы с флагом в БД — не могут.
    """
    if getattr(user, "id", None) == -1:
        return True
    return user_is_env_telegram_admin(user)


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
