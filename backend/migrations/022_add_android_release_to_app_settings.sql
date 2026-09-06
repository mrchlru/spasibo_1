-- Настройки релиза Android APK для промпта установки в мобильном браузере.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS android_release JSONB;
