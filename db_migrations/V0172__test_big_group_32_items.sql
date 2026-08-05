-- Проверка вашего сценария: связка из 32 вещей при стеке закройщика 20.
-- Ожидаем: закройщик получает ВСЮ связку целиком (32 заказа, а не 20), раскраивает её одной
-- кнопкой, и затем одна швея одним нажатием забирает все 32 вещи в работу.
INSERT INTO orders (order_number, marketplace, order_type, status, sewing_status, product,
                    quantity, source, material, width, height, ym_order_id,
                    group_key, group_size, group_position, created_at)
SELECT 'YMBIG-' || g, 'Yandex', 'FBS', 'Новый', 'Новый', 'Вуаль 300x270', 1, 'api',
       'Вуаль', 300, 270, 444444, 'YM-444444', 32, g,
       (SELECT min(created_at) - interval '2 minutes' FROM orders WHERE sewing_status = 'Новый')
FROM generate_series(1, 32) AS g;
