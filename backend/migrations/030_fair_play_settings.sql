-- Настройки Fair Play (вкл/выкл) в app_settings.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS fair_play JSONB;
