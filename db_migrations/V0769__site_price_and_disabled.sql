ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS site_price NUMERIC(12,2);
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS site_disabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS site_pushed_at TIMESTAMP;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS site_push_error TEXT;