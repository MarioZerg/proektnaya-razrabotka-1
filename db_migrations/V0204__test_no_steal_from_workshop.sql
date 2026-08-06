-- ТЕСТ 5: заказ УЖЕ в раскрое (OZ-TEST-01, закройщик взял его в работу).
-- Кладём на склад подходящую вещь: подбор НЕ должен её перехватывать —
-- ткань уже раскроена, труд потрачен, работу у цеха отбирать нельзя.
INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, source,
                    material, width, height, marketplace_item_id, sewing_status)
VALUES ('WH-TEST-05','OZON','FBS','Новый','Вуаль 200x260',1,'manual','Вуаль',200,260,7,'Готовые');

INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason)
SELECT id, 'in_stock', 'GW-TST005', 'admin' FROM orders WHERE order_number = 'WH-TEST-05';