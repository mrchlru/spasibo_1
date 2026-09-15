-- Состояние рекламы установки приложения на аккаунт (snooze / done).

CREATE TABLE IF NOT EXISTS install_promo_user_states (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    snoozed_until TIMESTAMPTZ NULL,
    done_at TIMESTAMPTZ NULL,
    done_reason VARCHAR(64) NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_install_promo_user_states_snoozed
    ON install_promo_user_states (snoozed_until)
    WHERE snoozed_until IS NOT NULL;
