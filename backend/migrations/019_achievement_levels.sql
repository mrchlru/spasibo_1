CREATE TABLE IF NOT EXISTS achievement_levels (
    id SERIAL PRIMARY KEY,
    achievement_id INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    level_number INTEGER NOT NULL,
    tier_key VARCHAR(32) NOT NULL DEFAULT 'bronze',
    image_url VARCHAR,
    how_to_obtain TEXT NOT NULL,
    UNIQUE (achievement_id, level_number)
);

CREATE INDEX IF NOT EXISTS idx_achievement_levels_achievement_id ON achievement_levels(achievement_id);

INSERT INTO achievement_levels (achievement_id, level_number, tier_key, image_url, how_to_obtain)
SELECT id, 1, 'bronze', image_url, how_to_obtain
FROM achievements
WHERE NOT EXISTS (
    SELECT 1 FROM achievement_levels al WHERE al.achievement_id = achievements.id
);

ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS achievement_level_id INTEGER REFERENCES achievement_levels(id) ON DELETE CASCADE;

UPDATE user_achievements ua
SET achievement_level_id = al.id
FROM achievement_levels al
WHERE al.achievement_id = ua.achievement_id
  AND al.level_number = 1
  AND ua.achievement_level_id IS NULL;

ALTER TABLE user_achievements DROP CONSTRAINT IF EXISTS uq_user_achievement;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'user_achievements' AND column_name = 'achievement_id'
    ) THEN
        ALTER TABLE user_achievements DROP COLUMN achievement_id;
    END IF;
END $$;

ALTER TABLE user_achievements DROP CONSTRAINT IF EXISTS uq_user_achievement_level;
ALTER TABLE user_achievements ADD CONSTRAINT uq_user_achievement_level UNIQUE (user_id, achievement_level_id);

ALTER TABLE achievements DROP COLUMN IF EXISTS how_to_obtain;
ALTER TABLE achievements DROP COLUMN IF EXISTS image_url;
