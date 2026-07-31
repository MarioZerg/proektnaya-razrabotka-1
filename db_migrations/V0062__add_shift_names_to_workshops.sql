ALTER TABLE workshops ADD COLUMN IF NOT EXISTS shift_names jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE workshops SET shift_names = '["Смена № 1", "Смена № 2"]'::jsonb WHERE id = 1;
UPDATE workshops SET shift_names = '["5/2"]'::jsonb WHERE id = 2;