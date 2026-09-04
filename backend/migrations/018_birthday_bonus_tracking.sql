-- Отслеживание начисления бонуса ко дню рождения (идемпотентность cron + scheduler).
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_birthday_bonus_date DATE;

COMMENT ON COLUMN users.last_birthday_bonus_date IS 'Дата (МСК), когда последний раз начислялся бонус ко дню рождения';
