-- ВОЗВРАТ УПАКОВКИ, СПИСАННОЙ ТЕСТОВЫМ ЗАКАЗОМ.
--
-- При проверке терминала тестовый заказ QA-TEST-ORD-1 закрывался от имени
-- администратора, а тот числится в цехе №1 — упаковка ушла с боевых рулонов
-- (пакет 3-004714 и этикетка 3-002811, по 1 шт). Само поведение правильное:
-- упаковка списывается из цеха упаковщицы, а не из цеха заказа. Но расход был
-- тестовый, поэтому возвращаем штуки на рулоны.
--
-- Записи расхода и начисления не удаляем (удаление данных запрещено) — они
-- останутся видны с пометкой QA в номере заказа, а на боевые остатки уже не
-- влияют: метраж возвращён.

UPDATE rolls r
SET remaining_quantity = r.remaining_quantity + omu.qty
FROM (
  SELECT roll_id, SUM(quantity) AS qty
  FROM order_material_usage
  WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'QA-TEST-%')
  GROUP BY roll_id
) omu
WHERE r.id = omu.roll_id;

-- Обнуляем тестовые начисления, не удаляя строки.
UPDATE salary_accruals SET amount = 0
WHERE description LIKE '%QA-TEST-ORD-%';
