-- Коды восстановления пароля по совпадению анкеты при повторной регистрации.
CREATE TABLE IF NOT EXISTS password_recovery_challenges (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL,
    code_hash VARCHAR(128) NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_password_recovery_token UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS ix_password_recovery_user_id
    ON password_recovery_challenges (user_id);

CREATE INDEX IF NOT EXISTS ix_password_recovery_expires_at
    ON password_recovery_challenges (expires_at);
