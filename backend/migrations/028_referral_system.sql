-- Реферальная система: код пользователя, атрибуции и состояние рекламы.

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS referral JSONB;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code VARCHAR(16);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_referral_code
  ON users (referral_code)
  WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS referral_attributions (
    id SERIAL PRIMARY KEY,
    campaign_key VARCHAR(64) NOT NULL,
    inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(24) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    send_days JSONB NOT NULL DEFAULT '[]'::jsonb,
    rewarded_at TIMESTAMPTZ NULL,
    inviter_bonus INTEGER NOT NULL DEFAULT 0,
    invitee_bonus INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_referral_invitee_campaign UNIQUE (invitee_id, campaign_key)
);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_inviter
  ON referral_attributions (inviter_id, attributed_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_status
  ON referral_attributions (status)
  WHERE status IN ('pending', 'in_progress');

CREATE TABLE IF NOT EXISTS referral_promo_user_states (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    snoozed_until TIMESTAMPTZ NULL,
    done_at TIMESTAMPTZ NULL,
    done_reason VARCHAR(64) NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_promo_user_states_snoozed
  ON referral_promo_user_states (snoozed_until)
  WHERE snoozed_until IS NOT NULL;
