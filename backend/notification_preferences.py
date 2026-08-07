"""Настройки типов уведомлений пользователя."""

from __future__ import annotations

from typing import Any

NotificationPreferenceKey = str

DEFAULT_NOTIFICATION_PREFERENCES: dict[str, bool] = {
    "birthdays": True,
    "likesReceived": True,
    "purchases": True,
    "sharedGifts": True,
    "profileUpdates": True,
    "achievements": True,
    "tasks": True,
    "systemNews": True,
}

PREFERENCE_KEYS: tuple[str, ...] = tuple(DEFAULT_NOTIFICATION_PREFERENCES.keys())


def normalize_notification_preferences(raw: dict[str, Any] | None) -> dict[str, bool]:
    """Возвращает полный набор настроек с дефолтами для отсутствующих ключей."""
    merged = dict(DEFAULT_NOTIFICATION_PREFERENCES)
    if not raw:
        return merged
    for key in PREFERENCE_KEYS:
        value = raw.get(key)
        if isinstance(value, bool):
            merged[key] = value
    return merged


def resolve_notification_preference_key(notification_type: str, title: str) -> str:
    """Определяет ключ настройки по типу и заголовку уведомления."""
    normalized_type = (notification_type or "").strip().lower()
    normalized_title = (title or "").lower()

    if normalized_type == "transfer":
        return "likesReceived"
    if normalized_type == "purchase":
        return "purchases"
    if normalized_type == "shared_gift":
        return "sharedGifts"
    if normalized_type == "profile":
        return "profileUpdates"
    if normalized_type == "achievement":
        return "achievements"
    if normalized_type == "task":
        return "tasks"
    if normalized_type == "system":
        if "день рождения" in normalized_title or "днём рождения" in normalized_title:
            return "birthdays"
        return "systemNews"
    return "systemNews"


def user_allows_notification(
    preferences: dict[str, Any] | None,
    notification_type: str,
    title: str,
) -> bool:
    """Проверяет, разрешён ли тип уведомления для пользователя."""
    normalized = normalize_notification_preferences(preferences)
    key = resolve_notification_preference_key(notification_type, title)
    return normalized.get(key, True)


def merge_notification_preferences_update(
    current: dict[str, Any] | None,
    update: dict[str, Any],
) -> dict[str, bool]:
    """Сливает частичное обновление с текущими настройками."""
    merged = normalize_notification_preferences(current)
    for key in PREFERENCE_KEYS:
        value = update.get(key)
        if isinstance(value, bool):
            merged[key] = value
    return merged
