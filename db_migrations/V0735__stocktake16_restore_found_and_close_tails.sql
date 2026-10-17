UPDATE orders SET fulfilled_from_stock_id = NULL
WHERE fulfilled_from_stock_id IN (
  SELECT g.id FROM goods_warehouse g
  WHERE (g.status IN ('lost', 'shipped') OR (g.status = 'awaiting_supply' AND g.reserved_order_id IS NULL))
    AND EXISTS (SELECT 1 FROM stocktake_scans s WHERE s.stocktake_id = 16 AND s.goods_warehouse_id = g.id)
    AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi JOIN marketplace_supplies ms ON ms.id = msi.supply_id
                    WHERE msi.goods_warehouse_id = g.id AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')));

INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description)
SELECT NULL, 'Система', 'warehouse', 'stocktake_restore', 'goods_warehouse', g.id,
  'Возвращена в остаток: найдена на полке при инвентаризации №16, а числилась '
  || CASE g.status WHEN 'lost' THEN 'списанной' WHEN 'shipped' THEN 'отгруженной' ELSE 'ждущей поставки без заказа' END
FROM goods_warehouse g
WHERE (g.status IN ('lost', 'shipped') OR (g.status = 'awaiting_supply' AND g.reserved_order_id IS NULL))
  AND EXISTS (SELECT 1 FROM stocktake_scans s WHERE s.stocktake_id = 16 AND s.goods_warehouse_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi JOIN marketplace_supplies ms ON ms.id = msi.supply_id
                  WHERE msi.goods_warehouse_id = g.id AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена'));

UPDATE goods_warehouse g SET
  status = CASE WHEN s.shelf_id IS NULL THEN 'awaiting_shelf' ELSE 'in_stock' END,
  shelf_id = s.shelf_id,
  storage_labeled_at = CASE WHEN s.shelf_id IS NULL THEN COALESCE(g.storage_labeled_at, now()) ELSE g.storage_labeled_at END,
  reserved_order_id = NULL, matched_at = NULL,
  picked_confirmed_at = NULL, picked_confirmed_by = NULL,
  shipping_labeled_at = NULL, shipping_labeled_by = NULL, shipping_labeled_by_name = NULL,
  shipped_at = NULL, lost_at = NULL, lost_reason = NULL,
  dispose_reason = NULL, disposed_at = NULL, disposed_by = NULL
FROM stocktake_scans s
WHERE s.stocktake_id = 16 AND s.goods_warehouse_id = g.id
  AND (g.status IN ('lost', 'shipped') OR (g.status = 'awaiting_supply' AND g.reserved_order_id IS NULL))
  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi JOIN marketplace_supplies ms ON ms.id = msi.supply_id
                  WHERE msi.goods_warehouse_id = g.id AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена'));

INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description)
SELECT NULL, 'Система', 'warehouse', 'stocktake_close_tail', 'goods_warehouse', g.id,
  CASE WHEN g.status = 'reserved' AND COALESCE(o.ozon_status, '') NOT LIKE 'cancel%'
       THEN 'Закрыта как отгруженная: висела в резерве, заказ уехал к покупателю, на полках по инвентаризации №16 её нет'
       ELSE 'Списана: висела в резерве/ожидании поставки, на полках по инвентаризации №16 её нет' END
FROM goods_warehouse g LEFT JOIN orders o ON o.id = g.reserved_order_id
WHERE (g.status = 'reserved' OR (g.status = 'awaiting_supply' AND g.reserved_order_id IS NULL))
  AND NOT EXISTS (SELECT 1 FROM stocktake_scans s WHERE s.stocktake_id = 16 AND s.goods_warehouse_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi JOIN marketplace_supplies ms ON ms.id = msi.supply_id
                  WHERE msi.goods_warehouse_id = g.id AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена'));

UPDATE goods_warehouse g SET
  status = CASE WHEN g.status = 'reserved' AND COALESCE(o.ozon_status, '') NOT LIKE 'cancel%' THEN 'shipped' ELSE 'lost' END,
  shipped_at = CASE WHEN g.status = 'reserved' AND COALESCE(o.ozon_status, '') NOT LIKE 'cancel%'
                    THEN COALESCE(g.shipping_labeled_at, now()) ELSE g.shipped_at END,
  lost_at = CASE WHEN g.status = 'reserved' AND COALESCE(o.ozon_status, '') NOT LIKE 'cancel%' THEN g.lost_at ELSE now() END,
  lost_reason = CASE WHEN g.status = 'reserved' AND COALESCE(o.ozon_status, '') NOT LIKE 'cancel%' THEN g.lost_reason
                     ELSE 'Не найдена при инвентаризации №16 (висела в резерве/ожидании поставки)' END,
  shelf_id = NULL
FROM goods_warehouse g2 LEFT JOIN orders o ON o.id = g2.reserved_order_id
WHERE g2.id = g.id
  AND (g.status = 'reserved' OR (g.status = 'awaiting_supply' AND g.reserved_order_id IS NULL))
  AND NOT EXISTS (SELECT 1 FROM stocktake_scans s WHERE s.stocktake_id = 16 AND s.goods_warehouse_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi JOIN marketplace_supplies ms ON ms.id = msi.supply_id
                  WHERE msi.goods_warehouse_id = g.id AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена'));