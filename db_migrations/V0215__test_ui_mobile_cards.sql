-- ТЕСТ мобильных карточек: несколько записей на складе и рулон, чтобы посмотреть
-- вёрстку на телефоне. После проверки будут выведены из оборота.
INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, source,
                    material, width, height, sewing_status)
VALUES
 ('UI-TEST-01','OZON','FBS','Выполнен','Вуаль 300x260',1,'manual','Вуаль',300,260,'Готовые'),
 ('UI-TEST-02','WB','FBO','Выполнен','Вуаль 200x240',1,'manual','Вуаль',200,240,'Готовые');

INSERT INTO goods_warehouse (order_id, shelf_id, status, storage_barcode, receive_reason)
SELECT id, 13, 'in_stock', 'GW-UI' || lpad((row_number() OVER (ORDER BY id))::text, 3, '0'), 'stickering'
FROM orders WHERE order_number IN ('UI-TEST-01','UI-TEST-02');