CREATE TABLE IF NOT EXISTS android_fcm_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR NOT NULL UNIQUE,
    concept_slug VARCHAR(64),
    device_name VARCHAR(128),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_android_fcm_tokens_user_id ON android_fcm_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_android_fcm_tokens_user_active ON android_fcm_tokens(user_id, is_active);
