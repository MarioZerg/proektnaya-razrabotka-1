-- Оплата закройщика: одна ставка на ткань вместо строки на каждую ширину.
--
-- Было 8 тканей x 7 ширин = 56 строк в каждом цехе, причём ставка внутри ткани везде
-- одинаковая (10 руб. в цехе №1, 6 руб. в цехе №2) — разбивка по ширине смысла не несла,
-- а заполнять и держать в голове приходилось 56 полей. Ширина и так участвует в расчёте:
-- сумма = ширина изделия в пог.м. x ставка, то есть за 8-метровое полотно платится
-- вчетверо больше, чем за 2-метровое, при одной и той же ставке за метр.
--
-- Строка с width IS NULL уже есть у каждой ткани — она и становится единственной ставкой.
-- Переносим в неё максимальную заполненную ставку по ткани, чтобы никому не занизить оплату.
UPDATE salary_rates sr
SET rate = src.max_rate,
    updated_at = now()
FROM (
  SELECT workshop_id, material_id, MAX(rate) AS max_rate
  FROM salary_rates
  WHERE role = 'cutter' AND material_id IS NOT NULL
  GROUP BY workshop_id, material_id
) src
WHERE sr.role = 'cutter'
  AND sr.width IS NULL
  AND sr.material_id = src.material_id
  AND sr.workshop_id = src.workshop_id
  AND sr.rate < src.max_rate;

-- Строки с конкретной шириной обнуляем: расчёт берёт ставку по материалу и ширине,
-- поэтому обнулённые строки в начислении не участвуют. Физически не удаляем —
-- удаление данных из миграций запрещено; лишние строки скрываются в интерфейсе.
UPDATE salary_rates
SET rate = 0,
    updated_at = now()
WHERE role = 'cutter' AND width IS NOT NULL;
