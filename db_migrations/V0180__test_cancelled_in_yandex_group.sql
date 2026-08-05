-- Проверка связки Яндекса: отменена ОДНА вещь из трёх. Ожидаем, что на полку уедет вся
-- связка целиком — ярлык на неё общий, неполный заказ отгружать нельзя.
INSERT INTO marketplace_supplies (marketplace, type, status, comment)
VALUES ('Yandex', 'FBS', 'На сборке', 'ТЕСТ отмены в связке');

INSERT INTO orders (order_number, marketplace, order_type, status, sewing_status, product,
                    quantity, source, material, width, height, ym_order_id,
                    group_key, group_size, group_position)
SELECT 'YMC-' || g, 'Yandex', 'FBS', CASE WHEN g = 2 THEN 'Отменён' ELSE 'Новый' END,
       'Готовые', 'Вуаль 300x270', 1, 'api', 'Вуаль', 300, 270, 333333,
       'YM-333333', 3, g
FROM generate_series(1, 3) AS g;

INSERT INTO goods_warehouse (order_id, storage_barcode, status, received_at)
SELECT o.id, 'GWY-' || o.order_number, 'picking', now()
FROM orders o WHERE o.group_key = 'YM-333333';

INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id)
SELECT (SELECT id FROM marketplace_supplies WHERE comment = 'ТЕСТ отмены в связке'), gw.id
FROM goods_warehouse gw
JOIN orders o ON o.id = gw.order_id
WHERE o.group_key = 'YM-333333';
