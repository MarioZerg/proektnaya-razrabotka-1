-- Проверка групповой выдачи заказов Яндекса на реальном конвейере: создаём тестовый заказ
-- покупателя из 3 вещей, чтобы убедиться, что закройщик берёт его целиком, а швея получает
-- все 3 вещи подряд. Данные удаляются следующей строкой после проверки.
INSERT INTO orders (order_number, marketplace, order_type, status, sewing_status, product,
                    quantity, source, material, width, height, ym_order_id,
                    group_key, group_size, group_position)
SELECT 'YMTEST-' || g, 'Яндекс', 'FBS', 'Новый', 'Новый', 'Тюль 300x270', 1, 'api',
       'Тюль', 300, 270, 999999, 'YM-999999', 3, g
FROM generate_series(1, 3) AS g
ON CONFLICT (order_number) DO NOTHING;
