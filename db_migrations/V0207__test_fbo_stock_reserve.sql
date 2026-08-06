-- ТЕСТ: кладём на склад 2 готовые вещи товара 5 (Вуаль 200x240).
-- Проверим, что менеджер при догрузке FBO зарезервирует их с полок, а не отправит в пошив.
INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, source,
                    material, width, height, marketplace_item_id, sewing_status)
VALUES
 ('WH-FBO-01','OZON','FBS','Новый','Вуаль 200x240',1,'manual','Вуаль',200,240,5,'Готовые'),
 ('WH-FBO-02','OZON','FBS','Новый','Вуаль 200x240',1,'manual','Вуаль',200,240,5,'Готовые');

INSERT INTO goods_warehouse (order_id, shelf_id, status, storage_barcode, receive_reason)
SELECT id, 13, 'in_stock', 'GW-FBO' || lpad((row_number() OVER (ORDER BY id))::text, 3, '0'), 'admin'
FROM orders WHERE order_number IN ('WH-FBO-01','WH-FBO-02');