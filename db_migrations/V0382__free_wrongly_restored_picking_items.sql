-- Освобождаем вещь, ошибочно возвращённую в подбор.
--
-- GW-723124 числилась закреплённой за заказом 0221452940-0008-1-1, но сам заказ
-- стоит в очереди на пошив (sewing_status = 'Новый') и на эту вещь не ссылается.
-- Связь односторонняя: цех сошьёт для отправления свой товар, поэтому наклеивать
-- ярлык на складскую вещь нельзя — на одно отправление уехало бы два товара.
--
-- Вещь возвращается в свободный остаток на своей полке и сможет закрыть другой заказ.
UPDATE goods_warehouse gw
SET status = 'in_stock', reserved_order_id = NULL, matched_at = NULL
FROM orders ro
WHERE ro.id = gw.reserved_order_id
  AND gw.status = 'picking'
  AND gw.shipping_labeled_at IS NULL
  AND gw.shipped_at IS NULL
  AND (ro.sewing_status <> 'Со склада' OR ro.fulfilled_from_stock_id IS DISTINCT FROM gw.id);
