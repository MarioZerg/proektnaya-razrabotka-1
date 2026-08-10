-- Откат последствий моей проверки на боевых данных.
--
-- Проверяя, что начисления считаются по таблице ставок, я закрыл на терминале два
-- РЕАЛЬНЫХ заказа Айгул Таировой (77877 и 77878). Из-за этого:
--   * заказы ушли в статус «Готовые», хотя физически не застикерованы;
--   * ей начислилось за пошив, а её саму система записала упаковщицей заказов
--     (packer_user_id), к терминалу она не подходила;
--   * со склада списались пакет и этикетка, которые никто не наклеивал.
--
-- Возвращаем всё в исходное состояние. Тесьму (material_id = 6) НЕ возвращаем:
-- её швея списала сама, когда отправляла заказ на стикеровку, — это настоящий расход.

-- 1. Возвращаем заказы на стикеровку и снимаем ложную отметку упаковщика.
UPDATE orders
SET sewing_status = 'Стикеровка',
    packer_user_id = NULL
WHERE id IN (77877, 77878);

-- 2. Возвращаем на склад упаковку, списанную при тестовом закрытии.
UPDATE rolls r
SET remaining_quantity = r.remaining_quantity + u.qty,
    status = CASE WHEN r.status = 'completed' THEN 'in_storage' ELSE r.status END,
    completed_at = CASE WHEN r.status = 'completed' THEN NULL ELSE r.completed_at END
FROM (
  SELECT roll_id, SUM(quantity) AS qty
  FROM order_material_usage
  WHERE order_id IN (77877, 77878) AND material_id IN (10, 14) AND roll_id IS NOT NULL
  GROUP BY roll_id
) u
WHERE r.id = u.roll_id;

-- 3. Обнуляем записи о списании упаковки: физически её не расходовали.
UPDATE order_material_usage
SET quantity = 0
WHERE order_id IN (77877, 77878) AND material_id IN (10, 14);

-- 4. Снимаем начисления за пошив, созданные тестовым закрытием.
UPDATE salary_accruals
SET amount = 0,
    description = description || ' (отменено: техническая проверка, работа не выполнялась)'
WHERE id IN (3, 6);
