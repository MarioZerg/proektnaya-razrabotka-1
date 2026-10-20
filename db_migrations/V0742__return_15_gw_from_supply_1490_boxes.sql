INSERT INTO orders (order_number, marketplace, order_type, status, product, source, sewing_status,
                    marketplace_item_id, product_ozon_sku, product_barcode, material, width, height)
SELECT 'ZAMENA-1490-' || g.storage_barcode, o.marketplace, 'FBO', 'Отгружен', o.product, 'manual',
       'Готовые', o.marketplace_item_id, o.product_ozon_sku, o.product_barcode, o.material, o.width, o.height
FROM marketplace_supply_items si
JOIN goods_warehouse g ON g.id = si.goods_warehouse_id
JOIN orders o ON o.id = g.order_id
WHERE si.supply_id = 1490 AND g.shipping_labeled_at IS NULL AND g.shelf_id IS NOT NULL
  AND g.storage_barcode IN ('GW-722860','GW-730022','GW-730907','GW-732084','GW-732740',
    'GW-732867','GW-732945','GW-733201','GW-733357','GW-734427','GW-734526','GW-734927',
    'GW-735377','GW-737040','GW-738302')
  AND NOT EXISTS (SELECT 1 FROM orders z WHERE z.order_number = 'ZAMENA-1490-' || g.storage_barcode);

INSERT INTO goods_warehouse (order_id, reserved_order_id, status, received_at, shipped_at,
                             storage_barcode, receive_reason, matched_at)
SELECT z.id,
       CASE WHEN g.status = 'shipped' THEN g.reserved_order_id ELSE NULL END,
       'shipped', g.received_at, COALESCE(g.shipped_at, now()),
       'GW-1490-ZAMENA-' || g.id, 'admin', now()
FROM marketplace_supply_items si
JOIN goods_warehouse g ON g.id = si.goods_warehouse_id
JOIN orders z ON z.order_number = 'ZAMENA-1490-' || g.storage_barcode
WHERE si.supply_id = 1490 AND g.shipping_labeled_at IS NULL AND g.shelf_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM goods_warehouse x WHERE x.storage_barcode = 'GW-1490-ZAMENA-' || g.id);

INSERT INTO audit_log (user_name, category, action, entity_type, entity_id, description)
SELECT 'Система', 'warehouse', 'manual_fix', 'goods_warehouse', g.id,
       g.storage_barcode || ' снят с короба поставки #1490 и возвращён на склад: вещь физически '
       || 'на полке, в короб её записала программа вместо отстикерованной. Место в коробе заняла '
       || 'запись GW-1490-ZAMENA-' || g.id || ' (реальный пакет уехал, его номер не записан).'
FROM marketplace_supply_items si
JOIN goods_warehouse g ON g.id = si.goods_warehouse_id
WHERE si.supply_id = 1490
  AND EXISTS (SELECT 1 FROM goods_warehouse ng WHERE ng.storage_barcode = 'GW-1490-ZAMENA-' || g.id);

UPDATE orders o
SET fulfilled_from_stock_id = ng.id
FROM goods_warehouse g
JOIN goods_warehouse ng ON ng.storage_barcode = 'GW-1490-ZAMENA-' || g.id
WHERE g.status = 'shipped' AND o.fulfilled_from_stock_id = g.id;

UPDATE goods_warehouse g
SET status = 'in_stock', shipped_at = NULL, reserved_order_id = NULL, matched_at = NULL,
    picked_confirmed_at = NULL, picked_confirmed_by = NULL,
    shipping_labeled_at = NULL, shipping_labeled_by = NULL, shipping_labeled_by_name = NULL
WHERE g.status = 'shipped'
  AND EXISTS (SELECT 1 FROM goods_warehouse ng WHERE ng.storage_barcode = 'GW-1490-ZAMENA-' || g.id);

UPDATE marketplace_supply_items si
SET goods_warehouse_id = ng.id
FROM goods_warehouse ng
WHERE si.supply_id = 1490
  AND ng.storage_barcode = 'GW-1490-ZAMENA-' || si.goods_warehouse_id;