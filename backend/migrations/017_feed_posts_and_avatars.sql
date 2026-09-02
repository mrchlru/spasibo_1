-- Новости ленты, право публикации, локальные аватары
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS can_publish_feed_posts BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_storage_key VARCHAR(512);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMP;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_webp BYTEA;

CREATE TABLE IF NOT EXISTS feed_posts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    is_pinned BOOLEAN NOT NULL DEFAULT false,
    pin_order INTEGER NOT NULL DEFAULT 0,
    is_published BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    published_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_post_attachments (
    id SERIAL PRIMARY KEY,
    feed_post_id INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    kind VARCHAR(16) NOT NULL,
    url VARCHAR(1024) NOT NULL,
    filename VARCHAR(512),
    content_type VARCHAR(128),
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_feed_posts_published
    ON feed_posts(is_published, is_pinned, pin_order DESC, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_feed_post_attachments_post
    ON feed_post_attachments(feed_post_id, sort_order);
