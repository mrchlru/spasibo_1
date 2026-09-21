"""Восстановление доступа при повторной регистрации по совпадению анкеты."""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import models
import schemas
from crud import get_password_hash
from email_service import is_valid_email, send_email

logger = logging.getLogger(__name__)

_CHALLENGE_TTL = timedelta(minutes=30)
_CODE_TTL = timedelta(minutes=15)
_MAX_ATTEMPTS = 5
_MIN_MATCH_FIELDS = 2


class AccountRecoveryError(Exception):
    """Ошибка сценария восстановления доступа."""

    def __init__(self, message: str, *, code: str = "recovery_error") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def _utcnow() -> datetime:
    """Текущий UTC (naive, как в остальных таблицах)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalize_name(value: str | None) -> str:
    """Нормализует имя/фамилию для сравнения."""
    return " ".join(str(value or "").strip().lower().split())


def _normalize_email(value: str | None) -> str:
    """Нормализует email."""
    return str(value or "").strip().lower()


def _normalize_phone(value: str | None) -> str:
    """Нормализует телефон до цифр с ведущей 7."""
    digits = re.sub(r"\D", "", value or "")
    if not digits:
        return ""
    if len(digits) == 10:
        digits = f"7{digits}"
    elif len(digits) == 11 and digits.startswith("8"):
        digits = f"7{digits[1:]}"
    return digits


def _hash_code(code: str) -> str:
    """Хеширует код подтверждения."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _count_field_matches(
    user: models.User,
    *,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
) -> int:
    """Считает совпадения по имени, фамилии, email и телефону."""
    score = 0
    if first_name and _normalize_name(user.first_name) == first_name:
        score += 1
    if last_name and _normalize_name(user.last_name) == last_name:
        score += 1
    user_email = _normalize_email(user.email)
    if email and user_email and user_email == email:
        score += 1
    user_phone = _normalize_phone(user.phone_number)
    if phone and user_phone and user_phone == phone:
        score += 1
    return score


async def find_best_matching_user(
    db: AsyncSession,
    *,
    first_name: str | None,
    last_name: str | None,
    email: str | None,
    phone_number: str | None,
) -> models.User | None:
    """Ищет approved/blocked пользователя с ≥2 совпадениями анкеты."""
    norm_first = _normalize_name(first_name)
    norm_last = _normalize_name(last_name)
    norm_email = _normalize_email(email)
    norm_phone = _normalize_phone(phone_number)
    if sum(1 for part in (norm_first, norm_last, norm_email, norm_phone) if part) < _MIN_MATCH_FIELDS:
        return None

    filters = [models.User.status.in_(("approved", "blocked"))]
    or_parts = []
    if norm_first:
        or_parts.append(models.User.first_name.ilike(first_name.strip()))
    if norm_last:
        or_parts.append(models.User.last_name.ilike(last_name.strip()))
    if norm_email:
        or_parts.append(models.User.email.ilike(norm_email))
    if or_parts:
        filters.append(or_(*or_parts))

    result = await db.execute(select(models.User).where(*filters).limit(200))
    candidates = list(result.scalars().all())
    best: models.User | None = None
    best_score = 0
    for user in candidates:
        score = _count_field_matches(
            user,
            first_name=norm_first,
            last_name=norm_last,
            email=norm_email,
            phone=norm_phone,
        )
        if score > best_score:
            best = user
            best_score = score
    if best is None or best_score < _MIN_MATCH_FIELDS:
        return None
    return best


async def create_recovery_challenge(
    db: AsyncSession,
    user: models.User,
) -> models.PasswordRecoveryChallenge:
    """Создаёт challenge-токен для дальнейшего ввода кода / смены пароля."""
    row = models.PasswordRecoveryChallenge(
        user_id=user.id,
        token=secrets.token_urlsafe(32),
        code_hash=None,
        attempts=0,
        expires_at=_utcnow() + _CHALLENGE_TTL,
        consumed_at=None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    logger.info("Recovery challenge created user_id=%s challenge_id=%s", user.id, row.id)
    return row


def build_match_response(
    user: models.User,
    challenge: models.PasswordRecoveryChallenge,
) -> schemas.ExistingAccountMatchResponse:
    """Формирует ответ о найденном аккаунте (без телефона)."""
    email = (user.email or "").strip()
    has_email = bool(email) and is_valid_email(email)
    return schemas.ExistingAccountMatchResponse(
        code="existing_account_match",
        recovery_token=challenge.token,
        has_email=has_email,
        email=email if has_email else None,
        first_name=user.first_name,
        last_name=user.last_name,
        message=(
            "Похоже, у вас уже есть аккаунт. Можно восстановить доступ по коду на почту."
            if has_email
            else "Похоже, у вас уже есть аккаунт, но email не указан. Восстановите доступ через форму «Забыли пароль?»."
        ),
    )


async def _get_open_challenge(
    db: AsyncSession,
    token: str,
) -> models.PasswordRecoveryChallenge:
    """Возвращает действующий challenge по токену."""
    normalized = (token or "").strip()
    if not normalized:
        raise AccountRecoveryError("Некорректный токен восстановления.", code="invalid_token")
    result = await db.execute(
        select(models.PasswordRecoveryChallenge).where(
            models.PasswordRecoveryChallenge.token == normalized
        ).limit(1)
    )
    row = result.scalars().first()
    if row is None:
        raise AccountRecoveryError("Ссылка восстановления недействительна.", code="invalid_token")
    if row.consumed_at is not None:
        raise AccountRecoveryError("Код уже использован. Начните восстановление заново.", code="consumed")
    if row.expires_at < _utcnow():
        raise AccountRecoveryError("Срок восстановления истёк. Начните заново.", code="expired")
    return row


async def send_recovery_code(
    db: AsyncSession,
    *,
    recovery_token: str,
) -> schemas.AccountRecoverySendCodeResponse:
    """Генерирует и отправляет код на email аккаунта."""
    challenge = await _get_open_challenge(db, recovery_token)
    user = await db.get(models.User, challenge.user_id)
    if user is None:
        raise AccountRecoveryError("Пользователь не найден.", code="user_not_found")
    email = (user.email or "").strip()
    if not email or not is_valid_email(email):
        raise AccountRecoveryError(
            "У аккаунта нет email — воспользуйтесь формой «Забыли пароль?».",
            code="no_email",
        )
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge.code_hash = _hash_code(code)
    challenge.attempts = 0
    challenge.expires_at = _utcnow() + _CODE_TTL
    await db.commit()

    user_name = f"{user.first_name or ''} {user.last_name or ''}".strip() or "коллега"
    subject = "Код восстановления доступа в «Спасибо»"
    body_html = (
        f"<p>Здравствуйте, {user_name}!</p>"
        f"<p>Код для восстановления доступа: <strong>{code}</strong></p>"
        f"<p>Код действует 15 минут. Если вы не запрашивали восстановление — игнорируйте письмо.</p>"
    )
    body_text = (
        f"Здравствуйте, {user_name}!\n\n"
        f"Код для восстановления доступа: {code}\n"
        f"Код действует 15 минут."
    )
    sent = await send_email(email, subject, body_html, body_text=body_text)
    if not sent:
        raise AccountRecoveryError(
            "Не удалось отправить письмо. Попробуйте позже или напишите администратору.",
            code="email_failed",
        )
    logger.info("Recovery code sent user_id=%s challenge_id=%s", user.id, challenge.id)
    return schemas.AccountRecoverySendCodeResponse(
        ok=True,
        message=f"Код отправлен на {email}",
        email=email,
    )


async def confirm_recovery_password(
    db: AsyncSession,
    *,
    recovery_token: str,
    code: str,
    new_password: str,
) -> schemas.AccountRecoveryConfirmResponse:
    """Проверяет код и устанавливает новый пароль."""
    password = (new_password or "").strip()
    if len(password) < 6:
        raise AccountRecoveryError("Пароль должен быть не короче 6 символов.", code="weak_password")
    challenge = await _get_open_challenge(db, recovery_token)
    if not challenge.code_hash:
        raise AccountRecoveryError("Сначала запросите код на email.", code="code_not_sent")
    if challenge.attempts >= _MAX_ATTEMPTS:
        raise AccountRecoveryError("Слишком много попыток. Запросите код снова.", code="too_many_attempts")

    provided = (code or "").strip()
    if _hash_code(provided) != challenge.code_hash:
        challenge.attempts += 1
        await db.commit()
        raise AccountRecoveryError("Неверный код подтверждения.", code="bad_code")

    user = await db.get(models.User, challenge.user_id)
    if user is None:
        raise AccountRecoveryError("Пользователь не найден.", code="user_not_found")

    user.password_hash = get_password_hash(password)
    user.password_plain = password
    user.browser_auth_enabled = True
    if user.status == "blocked":
        pass
    challenge.consumed_at = _utcnow()
    await db.commit()
    logger.info("Recovery password set user_id=%s challenge_id=%s", user.id, challenge.id)
    return schemas.AccountRecoveryConfirmResponse(
        ok=True,
        message="Пароль обновлён. Войдите с новым паролем (логин или email).",
        login=user.login,
        email=user.email,
    )
