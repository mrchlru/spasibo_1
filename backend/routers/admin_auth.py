"""HTTP-эндпоинты сессии админ-панели (env: ADMIN_EMAILS + ADMIN_PANEL_PASSWORD)."""

from fastapi import APIRouter, Depends, HTTPException, Request, status

import schemas
from admin_panel_auth import (
    credentials_valid,
    mint_session_token,
    panel_auth_env_ready,
)
from dependencies import get_current_admin_panel_bearer_email
from security_hardening import client_ip_from_request, login_rate_limiter

router = APIRouter(prefix="/admin/auth", tags=["admin-auth"])


@router.post("/login", response_model=schemas.AdminPanelLoginResponse)
async def admin_panel_login(
    body: schemas.AdminPanelLoginRequest,
    request: Request,
) -> schemas.AdminPanelLoginResponse:
    """Выдаёт Bearer-токен при верном email и пароле из настроек."""
    ip = client_ip_from_request(request)
    login_rate_limiter.check_or_raise(f"admin-login:{ip}")
    login_rate_limiter.check_or_raise(
        f"admin-login-email:{body.email.strip().lower()}"
    )

    ok, _err = panel_auth_env_ready()
    if not ok:
        # Не светим имена переменных окружения наружу.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Вход в админ-панель временно недоступен",
        )
    email_norm = body.email.strip().lower()
    if not credentials_valid(email_norm, body.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
        )
    login_rate_limiter.reset(f"admin-login:{ip}")
    login_rate_limiter.reset(f"admin-login-email:{email_norm}")
    token, ttl = mint_session_token(email_norm)
    user = schemas.panel_admin_user_response(email_norm)
    return schemas.AdminPanelLoginResponse(
        access_token=token,
        token_type="bearer",
        expires_in=ttl,
        user=user,
    )


@router.get("/me", response_model=schemas.AdminPanelMeResponse)
async def admin_panel_me(
    email: str = Depends(get_current_admin_panel_bearer_email),
) -> schemas.AdminPanelMeResponse:
    """Проверяет Bearer и возвращает профиль панели (тот же JSON, что после login)."""
    return schemas.AdminPanelMeResponse(user=schemas.panel_admin_user_response(email))
