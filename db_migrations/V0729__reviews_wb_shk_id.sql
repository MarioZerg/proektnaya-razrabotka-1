ALTER TABLE reviews ADD COLUMN IF NOT EXISTS wb_shk_id BIGINT NULL;
CREATE INDEX IF NOT EXISTS ix_reviews_wb_shk_id ON reviews (wb_shk_id) WHERE wb_shk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_orders_wb_sticker_number ON orders (wb_sticker_number) WHERE wb_sticker_number IS NOT NULL;