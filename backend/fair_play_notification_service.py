"""Уведомления fair play: email админам и push пользователям."""

from __future__ import annotations

import asyncio
import html
import logging
from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_MSK = ZoneInfo("Europe/Moscow")


def _format_msk_datetime(value: datetime | str | None) -> str:
    if value is None:
        return "—"
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=ZoneInfo("UTC"))
    return value.astimezone(_MSK).strftime("%d.%m.%Y %H:%M")


def _user_display_name(data: dict[str, Any]) -> str:
    name = (data.get("name") or "").strip()
    if name:
        return name
    user_id = data.get("id")
    return f"ID {user_id}" if user_id is not None else "Пользователь"


async def _send_admin_fair_play_email(
    subject: str,
    html_body: str,
    text_body: str,
) -> bool:
    from email_service import send_fair_play_alert_to_admins

    return await send_fair_play_alert_to_admins(
        subject=subject,
        body_html=html_body,
        body_text=text_body,
    )


def _build_suspicious_email(payload: dict[str, Any]) -> tuple[str, str, str]:
    receiver = payload.get("receiver") or {}
    participants = payload.get("participants") or []
    trigger_date = payload.get("trigger_date", "—")
    distinct = payload.get("distinct_senders", 2)

    receiver_name = html.escape(_user_display_name(receiver))
    receiver_pos = html.escape(receiver.get("position") or "—")

    rows = ""
    text_lines = []
    for person in participants:
        pname = html.escape(_user_display_name(person))
        prole = "получатель" if person.get("role") == "receiver" else "отправитель"
        ppos = html.escape(person.get("position") or "—")
        rows += (
            f"<li><strong>{pname}</strong> ({prole}), {ppos}</li>"
        )
        text_lines.append(f"- {_user_display_name(person)} ({prole}), {person.get('position') or '—'}")

    subject = f"Fair Play: подозрительная активность — {_user_display_name(receiver)}"
    html_body = f"""
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 640px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #856404;">Замечена подозрительная активность</h2>
            <p>За {html.escape(str(trigger_date))} (МСК) у получателя <strong>{receiver_name}</strong>
            ({receiver_pos}) зафиксировано <strong>{distinct}</strong> разных отправителя спасибок.</p>
            <p>Санкции не применены — это пограничный случай. Пользователям проставлена метка
            «подозрительная активность» в приложении.</p>
            <ul>{rows}</ul>
            <p style="color:#666;font-size:14px;">Раздел админки: Fair Play.</p>
        </div>
    </body>
    </html>
    """
    text_body = (
        f"Fair Play: подозрительная активность\n\n"
        f"Дата (МСК): {trigger_date}\n"
        f"Получатель: {_user_display_name(receiver)}, {receiver.get('position') or '—'}\n"
        f"Разных отправителей: {distinct}\n\n"
        f"Участники:\n" + "\n".join(text_lines) + "\n\n"
        f"Санкции не применены. Смотрите раздел Fair Play в админке."
    )
    return subject, html_body, text_body


def _build_sanctions_email(payload: dict[str, Any]) -> tuple[str, str, str]:
    trigger_date = payload.get("trigger_date", "—")
    distinct = payload.get("distinct_senders", 3)
    banned = payload.get("banned") or []
    limited = payload.get("limited") or []

    banned_html = ""
    banned_text = []
    for item in banned:
        name = html.escape(_user_display_name(item))
        until = html.escape(_format_msk_datetime(item.get("ban_until")))
        strike = item.get("strike", "—")
        banned_html += (
            f"<li><strong>{name}</strong> — блокировка до {until} (МСК), "
            f"нарушение №{strike}</li>"
        )
        banned_text.append(
            f"- {_user_display_name(item)}: бан до {_format_msk_datetime(item.get('ban_until'))} (МСК), strike {strike}"
        )

    limited_html = ""
    limited_text = []
    for item in limited:
        name = html.escape(_user_display_name(item))
        until = html.escape(_format_msk_datetime(item.get("limit_until")))
        mode = item.get("limit_mode")
        cap = item.get("limit_cap")
        unit = "в неделю" if mode == "weekly" else "в день"
        limited_html += (
            f"<li><strong>{name}</strong> — лимит {cap} спасибо {unit} до {until} (МСК)</li>"
        )
        limited_text.append(
            f"- {_user_display_name(item)}: {cap} спасибо {unit} до {_format_msk_datetime(item.get('limit_until'))} (МСК)"
        )

    primary_name = _user_display_name(banned[0]) if banned else "нарушители"
    subject = f"Fair Play: применены санкции — {primary_name}"

    html_body = f"""
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 640px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #c0392b;">Fair Play: применены санкции</h2>
            <p>Дата (МСК): <strong>{html.escape(str(trigger_date))}</strong>.
            Разных отправителей одному получателю: <strong>{distinct}</strong>.</p>
            {"<h3>Заблокированные</h3><ul>" + banned_html + "</ul>" if banned_html else ""}
            {"<h3>Сниженный лимит</h3><ul>" + limited_html + "</ul>" if limited_html else ""}
            {"<p>Отправители без паттерна злоупотребления не ограничены.</p>" if banned and not limited else ""}
            <p style="color:#666;font-size:14px;">Управление санкциями: админка → Fair Play.</p>
        </div>
    </body>
    </html>
    """
    text_body = (
        f"Fair Play: применены санкции\n\n"
        f"Дата (МСК): {trigger_date}\n"
        f"Разных отправителей: {distinct}\n\n"
    )
    if banned_text:
        text_body += "Заблокированные:\n" + "\n".join(banned_text) + "\n\n"
    if limited_text:
        text_body += "Сниженный лимит:\n" + "\n".join(limited_text) + "\n\n"
    text_body += "Админка → Fair Play."
    return subject, html_body, text_body


async def _run_admin_fair_play_notification(payload: dict[str, Any]) -> None:
    """Отправляет email админам (ADMIN_EMAILS) о событии fair play."""
    try:
        event_type = payload.get("type")
        if event_type == "suspicious":
            subject, html_body, text_body = _build_suspicious_email(payload)
        elif event_type == "sanctions":
            subject, html_body, text_body = _build_sanctions_email(payload)
        else:
            logger.warning("Неизвестный тип fair-play уведомления: %s", event_type)
            return
        ok = await _send_admin_fair_play_email(subject, html_body, text_body)
        if ok:
            logger.info("Fair Play email админам отправлен: %s", event_type)
        else:
            logger.warning("Fair Play email админам не отправлен: %s", event_type)
    except Exception:
        logger.exception("Ошибка отправки fair-play email админам")


def schedule_fair_play_admin_notification(payload: dict[str, Any]) -> None:
    """Фоновая отправка email админам после commit транзакции."""
    task = asyncio.create_task(_run_admin_fair_play_notification(payload))

    def _log_failure(done_task: asyncio.Task) -> None:
        if done_task.cancelled():
            return
        try:
            done_task.result()
        except Exception:
            logger.exception("Фоновая fair-play рассылка админам завершилась с ошибкой")

    task.add_done_callback(_log_failure)


async def notify_user_sanction_lifted(
    db: AsyncSession,
    user_id: int,
    kind: Literal["ban", "limit"],
) -> None:
    """In-app уведомление + push (Web Push / FCM), если подписки есть."""
    import crud

    if kind == "ban":
        title = "Блокировка снята"
        message = (
            "Ограничение Fair Play снято. Вы снова можете отправлять и получать спасибки."
        )
        tag = f"fair-play-ban-lift-{user_id}"
    else:
        title = "Лимит восстановлен"
        message = (
            "Ограничение на отправку спасибок снято. Снова доступно до 3 спасибок в день."
        )
        tag = f"fair-play-limit-lift-{user_id}"

    await crud._create_notification(
        db,
        user_id,
        type="fair_play",
        title=title,
        message=message,
        click_url="/?panel=profile",
        push_tag=tag,
    )
