-- Приведение ставок к тому виду, как оплата устроена на деле.
--
-- 1) Упаковщик — за пог.м. на стикеровке, ставка ОДНА на цех. В таблице она была
--    размножена на 7 строк по тканям (одинаковые 4 руб.), хотя ткань на упаковку не
--    влияет. Расчёт брал первую попавшуюся строку без сортировки — какая именно,
--    зависело от везения.
-- 2) Перепаковка возврата — фиксировано за штуку, размер не важен. Ставка 20 руб. лежала
--    в семи строках по ширинам, а строка «без ширины» стояла с нулём. Расчёт ищет ставку
--    без фильтра по ширине и вполне мог взять именно нулевую — тогда упаковщица за
--    перепаковку не получала НИЧЕГО.
--
-- Эталоном в обоих случаях становится строка без ткани и без ширины: остальные обнуляем,
-- чтобы они не участвовали в расчёте (удалять данные из миграций нельзя).

-- Ставка упаковщика: заводим общую строку по цеху, если её ещё нет.
INSERT INTO salary_rates (role, material_id, width, rate, workshop_id)
SELECT 'packer', NULL, NULL, 0, w.id
FROM workshops w
WHERE NOT EXISTS (
  SELECT 1 FROM salary_rates sr
  WHERE sr.role = 'packer' AND sr.workshop_id = w.id
    AND sr.material_id IS NULL AND sr.width IS NULL
);

-- Переносим в неё максимальную заполненную ставку по цеху.
UPDATE salary_rates sr
SET rate = src.max_rate, updated_at = now()
FROM (
  SELECT workshop_id, MAX(rate) AS max_rate
  FROM salary_rates WHERE role = 'packer'
  GROUP BY workshop_id
) src
WHERE sr.role = 'packer' AND sr.material_id IS NULL AND sr.width IS NULL
  AND sr.workshop_id = src.workshop_id AND sr.rate < src.max_rate;

-- Строки по тканям больше не нужны.
UPDATE salary_rates SET rate = 0, updated_at = now()
WHERE role = 'packer' AND material_id IS NOT NULL;

-- Перепаковка: переносим ставку в строку «без ширины».
UPDATE salary_rates sr
SET rate = src.max_rate, updated_at = now()
FROM (
  SELECT workshop_id, MAX(rate) AS max_rate
  FROM salary_rates WHERE role = 'packer_repack'
  GROUP BY workshop_id
) src
WHERE sr.role = 'packer_repack' AND sr.width IS NULL
  AND sr.workshop_id = src.workshop_id AND sr.rate < src.max_rate;

UPDATE salary_rates SET rate = 0, updated_at = now()
WHERE role = 'packer_repack' AND width IS NOT NULL;
