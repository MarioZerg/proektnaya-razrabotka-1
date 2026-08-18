ALTER TABLE workshops
  ADD COLUMN IF NOT EXISTS material_free_shifts jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN workshops.material_free_shifts IS
 'Номера смен, у которых НЕТ собственного материала: они работают материалом других смен цеха (например, смена только из швей — берёт тесьму у смен 1 и 2). Своей колонки в таблице материалов такая смена не получает и видит остатки всех остальных смен цеха.';

UPDATE workshops SET material_free_shifts = '[3]'::jsonb WHERE name = 'Цех №1';
