-- Настройки типов уведомлений пользователя (JSON).
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB NULL;
