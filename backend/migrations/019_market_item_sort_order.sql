-- Порядок товаров в магазине и папка призовых картинок автовыдачи
ALTER TABLE market_items
    ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE market_items
    ADD COLUMN IF NOT EXISTS prize_folder_slug VARCHAR(120);

UPDATE market_items
SET sort_order = id
WHERE sort_order = 0;

CREATE INDEX IF NOT EXISTS idx_market_items_sort_order
    ON market_items(sort_order, id)
    WHERE is_archived = false;
