-- Проверка защиты от отгрузки неполного заказа с общим ярлыком.
-- Создаём тестовую поставку Яндекса и заказ покупателя из 2 вещей, но кладём в поставку
-- только ОДНУ вещь. Система обязана заблокировать перевод такой поставки в «Отгрузка».

INSERT INTO marketplace_supplies (marketplace, type, status, comment)
VALUES ('Yandex', 'FBS', 'На сборке', 'ТЕСТ проверки неполного заказа')
ON CONFLICT DO NOTHING;

INSERT INTO orders (order_number, marketplace, order_type, status, sewing_status, product,
                    quantity, source, material, width, height, ym_order_id,
                    group_key, group_size, group_position)
SELECT 'YMSHIP-' || g, 'Yandex', 'FBS', 'Новый', 'Готовые', 'Вуаль 300x270', 1, 'api',
       'Вуаль', 300, 270, 888888, 'YM-888888', 2, g
FROM generate_series(1, 2) AS g
ON CONFLICT (order_number) DO NOTHING;

-- Обе вещи лежат на складе готовыми к отгрузке.
INSERT INTO goods_warehouse (order_id, storage_barcode, status, received_at)
SELECT o.id, 'GWTEST-' || o.group_position, 'picking', now()
FROM orders o WHERE o.group_key = 'YM-888888'
ON CONFLICT DO NOTHING;

-- В поставку кладём только ПЕРВУЮ вещь — заказ собран наполовину.
INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id)
SELECT (SELECT id FROM marketplace_supplies WHERE comment = 'ТЕСТ проверки неполного заказа'), gw.id
FROM goods_warehouse gw
JOIN orders o ON o.id = gw.order_id
WHERE o.group_key = 'YM-888888' AND o.group_position = 1
ON CONFLICT DO NOTHING;
