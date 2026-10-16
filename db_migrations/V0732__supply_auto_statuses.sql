ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS auto_status_at TIMESTAMP NULL;
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS fbs_missing_count INTEGER NULL;
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS ozon_checked_at TIMESTAMP NULL;
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS ozon_state VARCHAR(64) NULL;
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS ozon_boxes_total INTEGER NULL;
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS ozon_boxes_accepted INTEGER NULL;
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS ozon_declared_qty INTEGER NULL;
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS ozon_accepted_qty INTEGER NULL;