ALTER TABLE feed_posts
    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_feed_posts_is_deleted
    ON feed_posts (is_deleted);
