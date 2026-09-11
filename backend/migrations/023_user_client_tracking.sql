-- Учёт платформы клиента и установок PWA / Android-приложения.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_client_platform VARCHAR(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_client_shell VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_ios_pwa BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_android_app BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS client_platform VARCHAR(16);
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS client_shell VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_users_last_client_platform ON users(last_client_platform);
CREATE INDEX IF NOT EXISTS idx_users_has_ios_pwa ON users(has_ios_pwa) WHERE has_ios_pwa = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_has_android_app ON users(has_android_app) WHERE has_android_app = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_sessions_client_platform ON user_sessions(client_platform);
