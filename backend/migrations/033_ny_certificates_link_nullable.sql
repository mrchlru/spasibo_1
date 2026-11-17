-- Миграция: сертификаты можно загрузить без ссылки (ссылка дописывается позже)
-- Дата: 2026-11-17

ALTER TABLE ny_certificates
    ALTER COLUMN link_url DROP NOT NULL;

ALTER TABLE ny_certificates
    ADD COLUMN IF NOT EXISTS content_type VARCHAR(100) NULL;

ALTER TABLE ny_certificates
    ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255) NULL;
