-- Проверка сценария: заказ отменили ПОСЛЕ стикеровки, когда вещь уже собрана в поставку.
-- Создаём поставку OZON FBS с двумя вещами: одну отменяем. Ожидаем: поставку нельзя
-- перевести в «Отгрузка», пока отменённая вещь не уедет на полку.
INSERT INTO marketplace_supplies (marketplace, type, status, comment)
VALUES ('OZON', 'FBS', 'На сборке', 'ТЕСТ отмены в поставке');

INSERT INTO orders (order_number, marketplace, order_type, status, sewing_status, product,
                    quantity, source, material, width, height)
VALUES
  ('CANC-OK-1', 'OZON', 'FBS', 'Новый', 'Готовые', 'Вуаль 300x270', 1, 'api', 'Вуаль', 300, 270),
  ('CANC-BAD-1', 'OZON', 'FBS', 'Отменён', 'Готовые', 'Вуаль 300x270', 1, 'api', 'Вуаль', 300, 270);

INSERT INTO goods_warehouse (order_id, storage_barcode, status, received_at)
SELECT o.id, 'GWC-' || o.order_number, 'picking', now()
FROM orders o WHERE o.order_number IN ('CANC-OK-1', 'CANC-BAD-1');

INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id)
SELECT (SELECT id FROM marketplace_supplies WHERE comment = 'ТЕСТ отмены в поставке'), gw.id
FROM goods_warehouse gw
JOIN orders o ON o.id = gw.order_id
WHERE o.order_number IN ('CANC-OK-1', 'CANC-BAD-1');
