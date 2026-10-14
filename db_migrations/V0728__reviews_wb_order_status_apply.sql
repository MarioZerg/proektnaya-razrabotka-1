ALTER TABLE reviews ADD COLUMN IF NOT EXISTS wb_order_status VARCHAR(32) NULL;
CREATE INDEX IF NOT EXISTS ix_reviews_wb_order_status ON reviews (wb_order_status)
  WHERE wb_order_status IS NOT NULL;