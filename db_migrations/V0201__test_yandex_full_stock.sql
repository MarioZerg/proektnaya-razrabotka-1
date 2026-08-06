-- ТЕСТ 2: докладываем на склад недостающую третью вещь (товар 6).
-- Теперь склад покрывает связку целиком — подбор должен закрыть ВСЕ 3 вещи заказа.
INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, source,
                    material, width, height, marketplace_item_id, sewing_status)
VALUES ('WH-TEST-03','OZON','FBS','Новый','Вуаль 200x250',1,'manual','Вуаль',200,250,6,'Готовые');

INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason)
SELECT id, 'in_stock', 'GW-TST003', 'admin' FROM orders WHERE order_number = 'WH-TEST-03';