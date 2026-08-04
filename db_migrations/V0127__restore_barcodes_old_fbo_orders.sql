-- Восстановление штрихкодов у старых готовых FBO-заказов OZON, импортированных до того,
-- как система начала сохранять product_barcode. Привязываем товар и штрихкод только там, где
-- по (material, width, height) в справочнике marketplace_items ровно ОДИН товар — тогда
-- сопоставление однозначно. Заказы без материала/размера или с несколькими кандидатами не трогаем.
UPDATE orders o
SET marketplace_item_id = mi.id,
    product_barcode = mi.barcode
FROM marketplace_items mi
WHERE o.marketplace = 'OZON'
  AND o.order_type = 'FBO'
  AND o.sewing_status = 'Готовые'
  AND (o.product_barcode IS NULL OR o.product_barcode = '')
  AND o.material IS NOT NULL AND o.width IS NOT NULL AND o.height IS NOT NULL
  AND mi.material = o.material AND mi.width = o.width AND mi.height = o.height
  AND mi.barcode IS NOT NULL AND mi.barcode <> ''
  AND (
    SELECT COUNT(*) FROM marketplace_items c
    WHERE c.material = o.material AND c.width = o.width AND c.height = o.height
  ) = 1;