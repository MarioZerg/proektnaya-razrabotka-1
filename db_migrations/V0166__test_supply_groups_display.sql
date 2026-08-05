-- Проверка отображения связок: собираем поставку Яндекса, где один заказ покупателя собран
-- целиком (2 из 2), а второй — наполовину (1 из 3). Кладовщик должен видеть оба состояния.
INSERT INTO marketplace_supplies (marketplace, type, status, comment)
VALUES ('Yandex', 'FBS', 'На сборке', 'ТЕСТ отображения связок');

-- Заказ А: 2 вещи, обе попадут в поставку.
INSERT INTO orders (order_number, marketplace, order_type, status, sewing_status, product,
                    quantity, source, material, width, height, ym_order_id,
                    group_key, group_size, group_position)
SELECT 'YMG-A' || g, 'Yandex', 'FBS', 'Новый', 'Готовые', 'Вуаль 300x270', 1, 'api',
       'Вуаль', 300, 270, 777001, 'YM-777001', 2, g
FROM generate_series(1, 2) AS g;

-- Заказ Б: 3 вещи, в поставку попадёт только одна.
INSERT INTO orders (order_number, marketplace, order_type, status, sewing_status, product,
                    quantity, source, material, width, height, ym_order_id,
                    group_key, group_size, group_position)
SELECT 'YMG-B' || g, 'Yandex', 'FBS', 'Новый', 'Готовые', 'Сетка 400x260', 1, 'api',
       'Сетка', 400, 260, 777002, 'YM-777002', 3, g
FROM generate_series(1, 3) AS g;

INSERT INTO goods_warehouse (order_id, storage_barcode, status, received_at)
SELECT o.id, 'GWG-' || o.order_number, 'picking', now()
FROM orders o WHERE o.group_key IN ('YM-777001', 'YM-777002');

-- В поставку кладём: обе вещи заказа А и только первую вещь заказа Б.
INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id)
SELECT (SELECT id FROM marketplace_supplies WHERE comment = 'ТЕСТ отображения связок'), gw.id
FROM goods_warehouse gw
JOIN orders o ON o.id = gw.order_id
WHERE o.group_key = 'YM-777001'
   OR (o.group_key = 'YM-777002' AND o.group_position = 1);
