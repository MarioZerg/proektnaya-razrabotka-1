INSERT INTO audit_log (user_name, category, action, entity_type, entity_id, description)
SELECT 'Система', 'orders', 'manual_fix', 'order', o.id,
       'Заказ ' || o.order_number || ' закрыт как отгруженный: вещь ' || g.storage_barcode ||
       ' уехала к покупателю (OZON: ' || o.ozon_status || '), а заказ висел «Новый / Со склада» — автозакрытие отмечало только вещь.'
FROM orders o JOIN goods_warehouse g ON g.id = o.fulfilled_from_stock_id
WHERE o.sewing_status = 'Со склада' AND o.status NOT IN ('Отгружен','Выполнен','Отменён','Доставлен')
  AND g.status = 'shipped' AND g.reserved_order_id = o.id
  AND COALESCE(o.ozon_status,'') IN ('delivering','delivered','driver_pickup');

UPDATE orders o SET status = 'Отгружен', completed_at = COALESCE(o.completed_at, g.shipped_at, now())
FROM goods_warehouse g
WHERE g.id = o.fulfilled_from_stock_id
  AND o.sewing_status = 'Со склада' AND o.status NOT IN ('Отгружен','Выполнен','Отменён','Доставлен')
  AND g.status = 'shipped' AND g.reserved_order_id = o.id
  AND COALESCE(o.ozon_status,'') IN ('delivering','delivered','driver_pickup');

UPDATE orders o SET fulfilled_from_stock_id = NULL
FROM goods_warehouse g
WHERE g.id = o.fulfilled_from_stock_id
  AND COALESCE(o.ozon_status,'') LIKE 'cancel%'
  AND o.status NOT IN ('Отгружен','Выполнен','Доставлен')
  AND g.reserved_order_id IS DISTINCT FROM o.id;