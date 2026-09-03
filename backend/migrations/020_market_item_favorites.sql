CREATE TABLE IF NOT EXISTS market_item_favorites (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_item_id INTEGER NOT NULL REFERENCES market_items(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_market_item_favorites_user_item UNIQUE (user_id, market_item_id)
);

CREATE INDEX IF NOT EXISTS idx_market_item_favorites_item
    ON market_item_favorites (market_item_id);

CREATE INDEX IF NOT EXISTS idx_market_item_favorites_user
    ON market_item_favorites (user_id);
