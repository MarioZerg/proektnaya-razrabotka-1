ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS unit VARCHAR(20) NOT NULL DEFAULT 'шт';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS cost NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE inventory_items SET unit = 'п.м.', cost = 80 WHERE name = 'Вуаль';
UPDATE inventory_items SET unit = 'п.м.', cost = 86.25 WHERE name = 'Лён';
UPDATE inventory_items SET unit = 'п.м.', cost = 93 WHERE name = 'Сетка';