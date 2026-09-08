-- Ещё одна тестовая вещь под сценарий «брак при вскрытии».
INSERT INTO goods_warehouse (order_id, storage_barcode, status, received_at, storage_labeled_at)
SELECT o.id, 'QA-GW-' || o.id, 'repacking', now(), now()
FROM orders o
WHERE o.order_number = 'QA-TEST-ORD-4'
  AND NOT EXISTS (SELECT 1 FROM goods_warehouse gw WHERE gw.storage_barcode = 'QA-GW-' || o.id);

INSERT INTO marketplace_returns (marketplace, external_id, posting_number, order_id,
                                 product_name, quantity, status, goods_warehouse_id,
                                 return_reason, return_barcode, received_at)
SELECT 'OZON', 'QA-RET-' || o.id, o.order_number, o.id, o.product, 1, 'received',
       gw.id, 'Тестовая проверка брака', 'QA-RETBC-' || o.id, now()
FROM orders o
JOIN goods_warehouse gw ON gw.storage_barcode = 'QA-GW-' || o.id
WHERE o.order_number = 'QA-TEST-ORD-4'
  AND NOT EXISTS (SELECT 1 FROM marketplace_returns mr WHERE mr.external_id = 'QA-RET-' || o.id);

UPDATE goods_warehouse gw
SET repack_return_id = mr.id
FROM marketplace_returns mr
WHERE mr.goods_warehouse_id = gw.id AND mr.external_id LIKE 'QA-RET-%'
  AND gw.repack_return_id IS NULL;
