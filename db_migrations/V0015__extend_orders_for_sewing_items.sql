ALTER TABLE orders ADD COLUMN IF NOT EXISTS material VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS height INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sewing_status VARCHAR(30) NOT NULL DEFAULT 'Новый';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS workshop_id INTEGER REFERENCES workshops(id);

-- Разбираем существующее поле product вида "Вуаль 200x265" на материал/ширину/высоту
UPDATE orders
SET
    material = TRIM(SPLIT_PART(product, ' ', 1)),
    width = NULLIF(SPLIT_PART(SPLIT_PART(product, ' ', 2), 'x', 1), '')::INTEGER,
    height = NULLIF(SPLIT_PART(SPLIT_PART(product, ' ', 2), 'x', 2), '')::INTEGER
WHERE product ~ '^[^ ]+ [0-9]+x[0-9]+$';