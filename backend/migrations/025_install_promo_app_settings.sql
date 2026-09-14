-- Реклама установки приложения (ПК / iOS / Android-браузер): вкл/выкл из админки.

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS install_promo JSONB;
