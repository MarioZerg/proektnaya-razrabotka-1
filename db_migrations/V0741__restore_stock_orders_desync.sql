INSERT INTO t_p86119184_proektnaya_razrabotk.audit_log (user_name, category, action, entity_type, entity_id, description)
SELECT 'Система', 'warehouse', 'stock_order_restored', 'order', o.id,
       'Заказ #' || o.order_number || ' снова закрыт складской вещью ' || g.storage_barcode ||
       ': вещь числилась за ним, а заказ стоял в очереди на пошив (рассинхрон 20.10)'
FROM t_p86119184_proektnaya_razrabotk.orders o
JOIN t_p86119184_proektnaya_razrabotk.goods_warehouse g ON g.reserved_order_id = o.id
WHERE o.id IN (116824, 116754)
  AND o.sewing_status = 'Новый' AND o.cut_at IS NULL AND o.cutter_user_id IS NULL
  AND g.status IN ('in_stock', 'picking') AND g.shipped_at IS NULL;

UPDATE t_p86119184_proektnaya_razrabotk.orders o
SET sewing_status = 'Со склада', fulfilled_from_stock_id = g.id
FROM t_p86119184_proektnaya_razrabotk.goods_warehouse g
WHERE g.reserved_order_id = o.id
  AND o.id IN (116824, 116754)
  AND o.sewing_status = 'Новый' AND o.cut_at IS NULL AND o.cutter_user_id IS NULL
  AND g.status IN ('in_stock', 'picking') AND g.shipped_at IS NULL;