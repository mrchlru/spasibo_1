-- Миграция: новогодний ивент «Подарок»
-- Дата: 2026-11-17

CREATE TABLE IF NOT EXISTS ny_event_settings (
    id SERIAL PRIMARY KEY,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    starts_at TIMESTAMP NULL,
    ends_at TIMESTAMP NULL,
    taps_required INTEGER NOT NULL DEFAULT 7,
    photo_moderation_required BOOLEAN NOT NULL DEFAULT FALSE,
    low_stock_threshold INTEGER NOT NULL DEFAULT 20,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO ny_event_settings (
    is_active, taps_required, photo_moderation_required, low_stock_threshold, updated_at
)
SELECT FALSE, 7, FALSE, 20, NOW()
WHERE NOT EXISTS (SELECT 1 FROM ny_event_settings);

CREATE TABLE IF NOT EXISTS ny_certificate_batches (
    id SERIAL PRIMARY KEY,
    created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    files_count INTEGER NOT NULL DEFAULT 0,
    comment TEXT NULL
);

CREATE TABLE IF NOT EXISTS ny_certificates (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER NULL REFERENCES ny_certificate_batches(id) ON DELETE SET NULL,
    image_key VARCHAR(512) NOT NULL,
    thumb_key VARCHAR(512) NULL,
    link_url TEXT NOT NULL,
    nominal VARCHAR(64) NULL,
    title VARCHAR(255) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'available',
    issued_to_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    issued_at TIMESTAMP NULL,
    image_hash VARCHAR(64) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ny_certificates_issued_to_user
    ON ny_certificates (issued_to_user_id)
    WHERE issued_to_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_ny_certificates_status_id
    ON ny_certificates (status, id);

CREATE INDEX IF NOT EXISTS ix_ny_certificates_batch_id
    ON ny_certificates (batch_id);

CREATE INDEX IF NOT EXISTS ix_ny_certificates_image_hash
    ON ny_certificates (image_hash);

CREATE TABLE IF NOT EXISTS ny_participants (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    photo_key VARCHAR(512) NOT NULL,
    photo_thumb_key VARCHAR(512) NULL,
    photo_status VARCHAR(20) NOT NULL DEFAULT 'visible',
    photo_uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
    gift_opened_at TIMESTAMP NULL,
    certificate_id INTEGER NULL UNIQUE REFERENCES ny_certificates(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_ny_participants_photo_status
    ON ny_participants (photo_status);

CREATE INDEX IF NOT EXISTS ix_ny_participants_gift_opened_at
    ON ny_participants (gift_opened_at);

CREATE TABLE IF NOT EXISTS ny_event_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(40) NOT NULL,
    payload JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_ny_event_log_type_created
    ON ny_event_log (event_type, created_at);

CREATE INDEX IF NOT EXISTS ix_ny_event_log_user_created
    ON ny_event_log (user_id, created_at);
