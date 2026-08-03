-- OZON FBO: закрытие короба на стороне OZON (грузоместо cargo) и его этикетка (PDF).
-- ozon_cargo_id — id грузоместа на OZON; sticker — ссылка на PDF-этикетку короба.
ALTER TABLE marketplace_supply_boxes ADD COLUMN IF NOT EXISTS ozon_cargo_id BIGINT NULL;
ALTER TABLE marketplace_supply_boxes ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL;
ALTER TABLE marketplace_supply_boxes ADD COLUMN IF NOT EXISTS sticker_url TEXT NULL;
ALTER TABLE marketplace_supply_boxes ADD COLUMN IF NOT EXISTS sticker_name VARCHAR(255) NULL;
