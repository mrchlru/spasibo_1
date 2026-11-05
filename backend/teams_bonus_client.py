"""HTTP-клиент API Teams Bonus для карты и обмена спасибок."""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)


class TeamsBonusError(Exception):
    """Ошибка вызова Teams Bonus API."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


async def fetch_teams_bonus_card(spasibo_user_id: int) -> dict[str, Any]:
    """
    Загружает карту сотрудника по users.id из «Спасибо».

    Returns:
        JSON ответа GET /api/spasibo/card.
    """
    base_url = _base_url()
    timeout = httpx.Timeout(settings.TEAMS_BONUS_TIMEOUT_SECONDS or 15)
    params = {"user_id": str(spasibo_user_id)}
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.get(
                f"{base_url}/api/spasibo/card",
                params=params,
                headers=_auth_headers(),
            )
        except httpx.RequestError as exc:
            logger.error("Teams Bonus card request failed: %s", exc)
            raise TeamsBonusError("Teams Bonus недоступен, попробуйте позже.") from exc
    return _parse_json_response(response, "Не удалось загрузить карту Teams Bonus")


async def fetch_teams_bonus_history(
    spasibo_user_id: int,
    *,
    before: int | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    """Следующая порция истории операций по карте."""
    base_url = _base_url()
    timeout = httpx.Timeout(settings.TEAMS_BONUS_TIMEOUT_SECONDS or 15)
    params: dict[str, str | int] = {"user_id": str(spasibo_user_id), "limit": limit}
    if before is not None:
        params["before"] = before
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.get(
                f"{base_url}/api/spasibo/history",
                params=params,
                headers=_auth_headers(),
            )
        except httpx.RequestError as exc:
            logger.error("Teams Bonus history request failed: %s", exc)
            raise TeamsBonusError("Teams Bonus недоступен, попробуйте позже.") from exc
    return _parse_json_response(response, "Не удалось загрузить историю Teams Bonus")


async def fetch_teams_bonus_partners() -> dict[str, Any]:
    """Каталог ресторанов-партнёров."""
    base_url = _base_url()
    timeout = httpx.Timeout(settings.TEAMS_BONUS_TIMEOUT_SECONDS or 15)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.get(
                f"{base_url}/api/spasibo/partners",
                headers=_auth_headers(),
            )
        except httpx.RequestError as exc:
            logger.error("Teams Bonus partners request failed: %s", exc)
            raise TeamsBonusError("Teams Bonus недоступен, попробуйте позже.") from exc
    return _parse_json_response(response, "Не удалось загрузить партнёров Teams Bonus")


async def link_teams_bonus_holder(
    spasibo_user_id: int,
    teams_card: str,
    *,
    replace_conflicts: bool = True,
) -> dict[str, Any]:
    """Привязывает users.id «Спасибо» к карте Teams (MR-…, short code или token)."""
    base_url = _base_url()
    timeout = httpx.Timeout(settings.TEAMS_BONUS_TIMEOUT_SECONDS or 15)
    payload = {
        "spasibo_user_id": str(spasibo_user_id),
        "teams_card": (teams_card or "").strip(),
        "replace_conflicts": replace_conflicts,
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(
                f"{base_url}/api/spasibo/link",
                json=payload,
                headers=_auth_headers(),
            )
        except httpx.RequestError as exc:
            logger.error("Teams Bonus link failed: %s", exc)
            raise TeamsBonusError("Teams Bonus недоступен, попробуйте позже.") from exc
    return _parse_json_response(response, "Не удалось привязать карту Teams")


async def redeem_teams_bonus(
    spasibo_user_id: int,
    bonus_amount_rub: int,
    *,
    idempotency_key: str,
    comment: str = "",
) -> dict[str, Any]:
    """Начисляет бонусы на связанную карту Teams после списания спасибок."""
    base_url = _base_url()
    timeout = httpx.Timeout(settings.TEAMS_BONUS_TIMEOUT_SECONDS or 15)
    payload = {
        "spasibo_user_id": str(spasibo_user_id),
        "bonus_amount_rub": bonus_amount_rub,
        "comment": comment,
    }
    headers = {
        **_auth_headers(),
        "Idempotency-Key": idempotency_key,
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(
                f"{base_url}/api/spasibo/redeem",
                json=payload,
                headers=headers,
            )
        except httpx.RequestError as exc:
            logger.error("Teams Bonus redeem failed: %s", exc)
            raise TeamsBonusError("Teams Bonus недоступен, попробуйте позже.") from exc
    return _parse_json_response(response, "Не удалось начислить бонусы Teams")


def teams_bonus_configured() -> bool:
    """True, если интеграция включена и заданы URL и ключ."""
    if not settings.TEAMS_BONUS_ENABLED:
        return False
    return bool((settings.TEAMS_BONUS_BASE_URL or "").strip()) and bool(
        (settings.TEAMS_BONUS_API_KEY or "").strip()
    )


def _base_url() -> str:
    base = (settings.TEAMS_BONUS_BASE_URL or "").strip().rstrip("/")
    if not base:
        raise TeamsBonusError("Teams Bonus не настроен (TEAMS_BONUS_BASE_URL)")
    return base


def _auth_headers() -> dict[str, str]:
    key = (settings.TEAMS_BONUS_API_KEY or "").strip()
    if not key:
        raise TeamsBonusError("Teams Bonus не настроен (TEAMS_BONUS_API_KEY)")
    return {"X-Spasibo-Key": key}


def _parse_json_response(response: httpx.Response, fallback: str) -> dict[str, Any]:
    if response.status_code == 401:
        raise TeamsBonusError("Ошибка авторизации Teams Bonus")
    if response.status_code >= 400:
        detail = _extract_error_detail(response)
        raise TeamsBonusError(detail or fallback)
    try:
        data = response.json()
    except ValueError as exc:
        raise TeamsBonusError(fallback) from exc
    if not isinstance(data, dict):
        raise TeamsBonusError(fallback)
    return data


def _extract_error_detail(response: httpx.Response) -> Optional[str]:
    try:
        payload = response.json()
    except ValueError:
        return response.text or None
    if isinstance(payload, dict):
        detail = payload.get("detail")
        if isinstance(detail, str):
            return detail
        if isinstance(detail, list) and detail:
            first = detail[0]
            if isinstance(first, dict) and first.get("msg"):
                return str(first["msg"])
        for key in ("message", "error"):
            if payload.get(key):
                return str(payload[key])
    return response.text or None
