-- ТЕСТ: проверяем подбор Яндекса связкой. Заказ покупателя из 3 вещей, на складе только 2 —
-- подбор НЕ должен сработать, шьём всё, склад остаётся свободен.
INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, source,
                    material, width, height, marketplace_item_id, group_key, group_size, group_position,
                    sewing_status)
VALUES
 ('YM-TEST1-1','Yandex','FBS','Новый','Вуаль 200x240',1,'api','Вуаль',200,240,5,'YM-TEST1',3,1,'Новый'),
 ('YM-TEST1-2','Yandex','FBS','Новый','Вуаль 200x240',1,'api','Вуаль',200,240,5,'YM-TEST1',3,2,'Новый'),
 ('YM-TEST1-3','Yandex','FBS','Новый','Вуаль 200x250',1,'api','Вуаль',200,250,6,'YM-TEST1',3,3,'Новый');

-- Складские вещи: 2 шт товара 5, товара 6 НЕТ (значит связка не покрывается)
INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, source,
                    material, width, height, marketplace_item_id, sewing_status)
VALUES
 ('WH-TEST-01','OZON','FBS','Новый','Вуаль 200x240',1,'manual','Вуаль',200,240,5,'Готовые'),
 ('WH-TEST-02','OZON','FBS','Новый','Вуаль 200x240',1,'manual','Вуаль',200,240,5,'Готовые');

INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason)
SELECT id, 'in_stock', 'GW-TST' || lpad((row_number() OVER (ORDER BY id))::text, 3, '0'), 'admin'
FROM orders WHERE order_number IN ('WH-TEST-01','WH-TEST-02');