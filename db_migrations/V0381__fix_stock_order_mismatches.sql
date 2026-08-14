-- Чистка расхождений между заказами и складом готового товара.
--
-- Причина: со склада вручную удалили 155 вещей (в т.ч. ошибочные приёмки), но у заказов
-- осталась ссылка на удалённую вещь. Заказ числится «Со склада» и ждёт товар, которого
-- физически нет: в цех он не попадает, кладовщику подбирать нечего, на терминале тупик.
--
-- 1) Заказы, ссылающиеся на несуществующую вещь и ещё нужные маркетплейсу, — возвращаем
--    в производство: снимаем ссылку и ставим 'Новый', чтобы их раскроили и сшили заново.
UPDATE orders o
SET fulfilled_from_stock_id = NULL,
    sewing_status = 'Новый'
WHERE o.fulfilled_from_stock_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM goods_warehouse gw WHERE gw.id = o.fulfilled_from_stock_id)
  AND COALESCE(o.status, '') NOT IN ('Отгружен', 'Доставлен', 'Отменён');

-- 2) Заказы на удалённую вещь, которые УЖЕ отгружены: возвращать в цех нечего, просто
--    убираем битую ссылку, чтобы отчёты не ссылались в пустоту.
UPDATE orders o
SET fulfilled_from_stock_id = NULL
WHERE o.fulfilled_from_stock_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM goods_warehouse gw WHERE gw.id = o.fulfilled_from_stock_id);

-- 3) Мёртвые брони: вещь на складе держит заказ, который уже отгружен, отменён, уехал к
--    покупателю или ушёл шиться в цех. Такая вещь числится занятой и не видна как
--    свободный остаток — освобождаем её и возвращаем в наличие.
UPDATE goods_warehouse gw
SET reserved_order_id = NULL,
    matched_at = NULL,
    status = CASE WHEN gw.status = 'picking' THEN 'in_stock' ELSE gw.status END
FROM orders o
WHERE o.id = gw.reserved_order_id
  AND gw.status IN ('in_stock', 'picking')
  AND (COALESCE(o.status, '') IN ('Отменён', 'Отгружен', 'Доставлен')
       OR COALESCE(o.ozon_status, '') IN ('delivering', 'delivered', 'cancelled',
                                          'not_accepted', 'driver_pickup')
       OR o.sewing_status NOT IN ('Новый', 'Со склада'));

-- 4) Вещь помечена отгруженной, а её заказ остался открытым: отгрузка прошла, значит
--    заказ тоже закрыт — иначе он вечно висит в работе у производства.
UPDATE orders o
SET status = 'Отгружен',
    completed_at = COALESCE(o.completed_at, now())
FROM goods_warehouse gw
WHERE gw.reserved_order_id = o.id
  AND gw.status = 'shipped'
  AND COALESCE(o.status, '') NOT IN ('Отгружен', 'Доставлен', 'Отменён');
