-- ТЕСТ 3: обычный заказ OZON без складского покрытия — должен спокойно уйти в раскрой.
INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, source,
                    material, width, height, marketplace_item_id, sewing_status)
VALUES ('OZ-TEST-01','OZON','FBS','Новый','Вуаль 200x260',1,'api','Вуаль',200,260,7,'Новый');