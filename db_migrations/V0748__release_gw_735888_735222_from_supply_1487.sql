INSERT INTO orders (order_number, marketplace, order_type, status, product, source, sewing_status,
                    marketplace_item_id, product_ozon_sku, product_barcode, material, width, height)
SELECT 'ZAMENA-1487-' || g.storage_barcode, o.marketplace, 'FBO', 'Новый', o.product, 'manual',
       'Готовые', o.marketplace_item_id, o.product_ozon_sku, o.product_barcode, o.material, o.width, o.height
FROM goods_warehouse g
JOIN orders o ON o.id = g.order_id
WHERE g.id IN (13953, 14619) AND g.status = 'awaiting_supply'
  AND NOT EXISTS (SELECT 1 FROM orders z WHERE z.order_number = 'ZAMENA-1487-' || g.storage_barcode);

INSERT INTO goods_warehouse (order_id, reserved_order_id, status, received_at, storage_barcode,
                             receive_reason, matched_at, picked_confirmed_at, picked_confirmed_by,
                             shipping_labeled_at, taken_at, taken_by)
SELECT z.id, NULL, 'awaiting_supply', g.received_at, 'GW-1487-ZAMENA-' || g.id,
       'admin', now(), now(), g.picked_confirmed_by, now(), g.taken_at, g.taken_by
FROM goods_warehouse g
JOIN orders z ON z.order_number = 'ZAMENA-1487-' || g.storage_barcode
WHERE g.id IN (13953, 14619) AND g.status = 'awaiting_supply'
  AND NOT EXISTS (SELECT 1 FROM goods_warehouse x WHERE x.storage_barcode = 'GW-1487-ZAMENA-' || g.id);

UPDATE marketplace_supply_items si
SET goods_warehouse_id = ng.id
FROM goods_warehouse ng
WHERE si.supply_id = 1487 AND si.goods_warehouse_id IN (13953, 14619)
  AND ng.storage_barcode = 'GW-1487-ZAMENA-' || si.goods_warehouse_id;

UPDATE orders o
SET fulfilled_from_stock_id = ng.id
FROM goods_warehouse ng
WHERE o.fulfilled_from_stock_id IN (13953, 14619)
  AND ng.storage_barcode = 'GW-1487-ZAMENA-' || o.fulfilled_from_stock_id;

INSERT INTO audit_log (user_name, category, action, entity_type, entity_id, description)
SELECT 'Система', 'warehouse', 'manual_fix', 'goods_warehouse', g.id,
       g.storage_barcode || ' снят с короба №7 поставки FBO #1487 (2000070804829) и возвращён на склад без полки: '
       || 'вещь найдена, в короб уехал другой товар под другим GW. Место в коробе заняла запись GW-1487-ZAMENA-' || g.id || '.'
FROM goods_warehouse g
WHERE g.id IN (13953, 14619) AND g.status = 'awaiting_supply'
  AND EXISTS (SELECT 1 FROM goods_warehouse ng WHERE ng.storage_barcode = 'GW-1487-ZAMENA-' || g.id)
  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items si WHERE si.supply_id = 1487 AND si.goods_warehouse_id = g.id);

UPDATE goods_warehouse g
SET status = 'in_stock', shelf_id = NULL, reserved_order_id = NULL, matched_at = NULL, shipped_at = NULL,
    picked_confirmed_at = NULL, picked_confirmed_by = NULL,
    shipping_labeled_at = NULL, shipping_labeled_by = NULL, shipping_labeled_by_name = NULL
WHERE g.id IN (13953, 14619) AND g.status = 'awaiting_supply'
  AND EXISTS (SELECT 1 FROM goods_warehouse ng WHERE ng.storage_barcode = 'GW-1487-ZAMENA-' || g.id)
  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items si WHERE si.supply_id = 1487 AND si.goods_warehouse_id = g.id);

UPDATE goods_warehouse SET reserved_order_id = 113945
WHERE storage_barcode = 'GW-1487-ZAMENA-13953' AND reserved_order_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM goods_warehouse x WHERE x.reserved_order_id = 113945 AND x.shipped_at IS NULL AND x.status NOT IN ('shipped','lost'));

UPDATE goods_warehouse SET reserved_order_id = 113898
WHERE storage_barcode = 'GW-1487-ZAMENA-14619' AND reserved_order_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM goods_warehouse x WHERE x.reserved_order_id = 113898 AND x.shipped_at IS NULL AND x.status NOT IN ('shipped','lost'));