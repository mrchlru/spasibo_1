-- Fair play: антиабуз «спасибок» (карусель благодарностей).

ALTER TABLE users ADD COLUMN IF NOT EXISTS fair_play_strike_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fair_play_last_violation_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fair_play_ban_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fair_play_limit_mode VARCHAR(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS fair_play_limit_cap INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fair_play_limit_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fair_play_suspicious_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fair_play_weekly_sent_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fair_play_weekly_sent_for_date DATE;

CREATE TABLE IF NOT EXISTS fair_play_receiver_events (
    id SERIAL PRIMARY KEY,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trigger_date DATE NOT NULL,
    distinct_sender_count INTEGER NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (receiver_id, trigger_date)
);

CREATE INDEX IF NOT EXISTS idx_fair_play_receiver_events_date
    ON fair_play_receiver_events(trigger_date);

CREATE TABLE IF NOT EXISTS fair_play_audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(32) NOT NULL,
    related_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fair_play_audit_user ON fair_play_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_users_fair_play_ban_until ON users(fair_play_ban_until)
    WHERE fair_play_ban_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_fair_play_limit_until ON users(fair_play_limit_until)
    WHERE fair_play_limit_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_fair_play_suspicious_at ON users(fair_play_suspicious_at)
    WHERE fair_play_suspicious_at IS NOT NULL;
