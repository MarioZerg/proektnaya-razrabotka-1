-- ТЕСТ 4: главный сценарий. Заказ OZON ждёт пошива, склад пуст по этому товару.
-- Затем вещь появляется на полке (как будто швея дошила) — подбор должен сработать САМ
-- в момент укладки на полку, и заказ уйдёт со склада, а не в цех.
INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, source,
                    material, width, height, marketplace_item_id, sewing_status)
VALUES ('OZ-TEST-02','OZON','FBS','Новый','Вуаль 300x240',1,'api','Вуаль',300,240,8,'Новый');

-- Вещь, которую «дошили»: заводим её в статусе ожидания полки.
INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, source,
                    material, width, height, marketplace_item_id, sewing_status)
VALUES ('WH-TEST-04','OZON','FBS','Новый','Вуаль 300x240',1,'manual','Вуаль',300,240,8,'Готовые');

INSERT INTO goods_warehouse (order_id, status, storage_barcode, receive_reason)
SELECT id, 'awaiting_shelf', 'GW-TST004', 'cancelled' FROM orders WHERE order_number = 'WH-TEST-04';