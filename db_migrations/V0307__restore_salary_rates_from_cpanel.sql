-- Восстановление расценок зарплаты из старой системы.
--
-- При очистке системы таблица расценок обнулилась: осталось две пустые строки
-- с нулевой ставкой. Без расценок начисления не считаются вообще — сотрудник
-- работает, а деньги не капают.
--
-- Значения взяты из тарифов старой системы (cpanel). В старой системе тарифы были
-- привязаны к каждому сотруднику, у нас — к цеху: ставки у всех совпадали, поэтому
-- берём общее значение и заводим одинаково в оба цеха.
INSERT INTO salary_rates (role, material_id, width, rate, workshop_id)
SELECT v.role, v.material_id, v.width, v.rate, w.id
FROM (VALUES
  ('cutter', 1, NULL, 10.0),
  ('cutter', 2, NULL, 10.0),
  ('cutter', 3, NULL, 10.0),
  ('cutter', 4, NULL, 10.0),
  ('cutter', 5, NULL, 10.0),
  ('cutter', 15, NULL, 10.0),
  ('cutter', 16, NULL, 10.0),
  ('cutter', 33, NULL, 6.0),
  ('packer', 1, NULL, 3.5),
  ('packer', 2, NULL, 3.5),
  ('packer', 3, NULL, 3.5),
  ('packer', 4, NULL, 3.5),
  ('packer', 5, NULL, 3.5),
  ('packer', 15, NULL, 3.5),
  ('packer', 16, NULL, 3.5),
  ('packer_repack', NULL, 200, 20.0),
  ('packer_repack', NULL, 300, 20.0),
  ('packer_repack', NULL, 400, 20.0),
  ('packer_repack', NULL, 500, 20.0),
  ('packer_repack', NULL, 600, 20.0),
  ('packer_repack', NULL, 700, 20.0),
  ('packer_repack', NULL, 800, 20.0),
  ('sewer', NULL, 200, 51.0),
  ('sewer', NULL, 300, 75.6),
  ('sewer', NULL, 400, 89.2),
  ('sewer', NULL, 500, 101.5),
  ('sewer', NULL, 600, 116.3),
  ('sewer', NULL, 700, 132.1),
  ('sewer', NULL, 800, 141.25),
  ('storekeeper', NULL, NULL, 2270.0)
) AS v(role, material_id, width, rate)
CROSS JOIN workshops w
WHERE w.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM salary_rates sr
    WHERE sr.workshop_id = w.id
      AND sr.role = v.role
      AND sr.material_id IS NOT DISTINCT FROM v.material_id
      AND sr.width IS NOT DISTINCT FROM v.width
  );

-- Старший кладовщик и уборщица получают оклад за смену — заводим строки,
-- чтобы их можно было задать в интерфейсе, а не искать, почему роли не видно.
INSERT INTO salary_rates (role, material_id, width, rate, workshop_id)
SELECT v.role, NULL, NULL, 0, w.id
FROM (VALUES ('senior_storekeeper'), ('cleaner'), ('admin')) AS v(role)
CROSS JOIN workshops w
WHERE w.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM salary_rates sr
    WHERE sr.workshop_id = w.id AND sr.role = v.role
      AND sr.material_id IS NULL AND sr.width IS NULL
  );
