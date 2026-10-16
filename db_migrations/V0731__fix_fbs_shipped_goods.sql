WITH stuck AS (
  SELECT gw.id, MAX(s.completed_at) AS done_at
  FROM goods_warehouse gw
  JOIN marketplace_supply_items si ON si.goods_warehouse_id = gw.id
  JOIN marketplace_supplies s ON s.id = si.supply_id
  JOIN orders o ON o.id = gw.reserved_order_id
  WHERE gw.status = 'reserved'
    AND gw.shipped_at IS NULL
    AND s.status = 'Выполнена'
    AND (COALESCE(o.status, '') IN ('Отгружен', 'Доставлен')
         OR COALESCE(o.ozon_status, '') IN ('delivering', 'delivered', 'driver_pickup'))
    AND NOT EXISTS (
      SELECT 1 FROM marketplace_supply_items l_si
      JOIN marketplace_supplies l_s ON l_s.id = l_si.supply_id
      WHERE l_si.goods_warehouse_id = gw.id
        AND COALESCE(l_s.status, '') NOT IN ('Выполнена', 'Отменена'))
  GROUP BY gw.id
), upd AS (
  UPDATE goods_warehouse gw
  SET status = 'shipped', shipped_at = COALESCE(stuck.done_at, now())
  FROM stuck
  WHERE gw.id = stuck.id
  RETURNING gw.id
)
INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description)
SELECT NULL, 'Система', 'warehouse', 'close_shipped', 'goods_warehouse', upd.id,
       'Отмечена отгруженной: уехала в выполненной поставке FBS, но статус не обновился (сбой 14–16.10)'
FROM upd;