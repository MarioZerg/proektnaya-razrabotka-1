INSERT INTO orders (order_number, marketplace, order_type, status, product, source, sewing_status,
                    marketplace_item_id, product_ozon_sku, product_barcode, material, width, height)
SELECT '2000069879178-33-ZAMENA', marketplace, order_type, 'Отгружен', product, 'manual', 'Готовые',
       marketplace_item_id, product_ozon_sku, product_barcode, material, width, height
FROM orders
WHERE id = 109448
  AND NOT EXISTS (SELECT 1 FROM orders WHERE order_number = '2000069879178-33-ZAMENA');

INSERT INTO goods_warehouse (order_id, reserved_order_id, status, received_at, shipped_at, storage_barcode, receive_reason, matched_at)
SELECT (SELECT id FROM orders WHERE order_number = '2000069879178-33-ZAMENA'), 109448, 'shipped',
       gw.received_at, gw.shipped_at, 'GW-1457-386-ZAMENA', 'admin', now()
FROM goods_warehouse gw
WHERE gw.id = 9736 AND gw.reserved_order_id = 109448
  AND NOT EXISTS (SELECT 1 FROM goods_warehouse WHERE storage_barcode = 'GW-1457-386-ZAMENA');

UPDATE marketplace_supply_items
SET goods_warehouse_id = (SELECT id FROM goods_warehouse WHERE storage_barcode = 'GW-1457-386-ZAMENA')
WHERE id = 16202 AND supply_id = 1457 AND goods_warehouse_id = 9736
  AND EXISTS (SELECT 1 FROM goods_warehouse WHERE storage_barcode = 'GW-1457-386-ZAMENA');

UPDATE goods_warehouse
SET status = 'in_stock', reserved_order_id = NULL, shipped_at = NULL, matched_at = NULL
WHERE id = 9736
  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items WHERE goods_warehouse_id = 9736);

INSERT INTO audit_log (category, action, entity_type, entity_id, description)
VALUES ('warehouse', 'manual_fix', 'goods_warehouse', 9736,
        'GW-731063 снят с короба 386 поставки #1457 и возвращён на склад (полка 26). В коробе его место заняла запись GW-1457-386-ZAMENA: реальный пакет уехал, его номер не записан.');