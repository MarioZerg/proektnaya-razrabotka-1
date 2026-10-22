INSERT INTO audit_log (user_name, category, action, entity_type, entity_id, description)
SELECT 'Система', 'warehouse', 'manual_fix', 'order', o.id,
       'Пустая карточка ручного приёма ' || o.order_number || ' снята (отменена): вещь по ней раньше удалили со склада, а карточка осталась «Готовые».'
FROM orders o
WHERE o.order_number IN ('WH-01269','WH-01268','WH-01267','WH-01270','WH-01271','WH-01299','WH-01106','WH-01035','WH-01334','WH-01332','WH-01338','WH-01340','WH-01342','WH-01343','WH-01162','WH-01363','WH-01402','WH-01437','WH-01458')
  AND o.source = 'manual' AND o.status = 'Новый'
  AND NOT EXISTS (SELECT 1 FROM goods_warehouse g WHERE g.order_id = o.id OR g.reserved_order_id = o.id);

UPDATE orders o SET status = 'Отменён', cancelled_at = COALESCE(o.cancelled_at, now())
WHERE o.order_number IN ('WH-01269','WH-01268','WH-01267','WH-01270','WH-01271','WH-01299','WH-01106','WH-01035','WH-01334','WH-01332','WH-01338','WH-01340','WH-01342','WH-01343','WH-01162','WH-01363','WH-01402','WH-01437','WH-01458')
  AND o.source = 'manual' AND o.status = 'Новый'
  AND NOT EXISTS (SELECT 1 FROM goods_warehouse g WHERE g.order_id = o.id OR g.reserved_order_id = o.id);

UPDATE orders o SET status = 'Отменён', cancelled_at = COALESCE(o.cancelled_at, now())
WHERE o.source = 'manual' AND o.order_number LIKE 'WH-%' AND o.status = 'Новый' AND o.sewing_status = 'Готовые'
  AND NOT EXISTS (SELECT 1 FROM goods_warehouse g WHERE g.order_id = o.id OR g.reserved_order_id = o.id);