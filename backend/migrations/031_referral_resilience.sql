-- Отказоустойчивость рефералки: код, с которым пришли, и код в атрибуции.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referred_by_code VARCHAR(16);

CREATE INDEX IF NOT EXISTS idx_users_referred_by_code
  ON users (referred_by_code)
  WHERE referred_by_code IS NOT NULL;

ALTER TABLE referral_attributions
  ADD COLUMN IF NOT EXISTS referral_code_used VARCHAR(16);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_code_used
  ON referral_attributions (referral_code_used)
  WHERE referral_code_used IS NOT NULL;
