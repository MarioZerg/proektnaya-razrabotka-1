-- ТЕСТ тарифа перепаковки: две вещи на перепаковке.
-- Одну упаковщица переупакует (должно начислиться 20 руб), вторую спишет как брак
-- (начисления быть НЕ должно).
INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, source,
                    material, width, height, marketplace_item_id, sewing_status)
VALUES
 ('RET-TEST-01','OZON','FBO','Выполнен','Вуаль 200x240',1,'return','Вуаль',200,240,5,'Готовые'),
 ('RET-TEST-02','OZON','FBO','Выполнен','Вуаль 200x250',1,'return','Вуаль',200,250,6,'Готовые');

INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason)
SELECT id, 'repacking', 'GW-RPK' || lpad((row_number() OVER (ORDER BY id))::text, 3, '0'), 'return'
FROM orders WHERE order_number IN ('RET-TEST-01','RET-TEST-02');