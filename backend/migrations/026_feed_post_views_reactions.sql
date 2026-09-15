-- Просмотры и реакции на новости ленты.

CREATE TABLE IF NOT EXISTS feed_post_views (
    id SERIAL PRIMARY KEY,
    feed_post_id INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_feed_post_view_user UNIQUE (feed_post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_post_views_post
    ON feed_post_views(feed_post_id);

CREATE TABLE IF NOT EXISTS feed_post_reactions (
    id SERIAL PRIMARY KEY,
    feed_post_id INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_feed_post_reaction_user UNIQUE (feed_post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_post_reactions_post
    ON feed_post_reactions(feed_post_id);
