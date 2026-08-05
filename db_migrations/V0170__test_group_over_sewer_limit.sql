-- Проверка вашего сценария: заказ Яндекса из 5 вещей при лимите 3 заказа на швею.
-- Без исключения швея упёрлась бы в лимит на 3-й вещи, и недошитый заказ повис бы: добрать
-- его не может ни она (лимит), ни другая швея (связка закреплена). Ставим лимит 3 и создаём
-- заказ из 5 раскроенных вещей.
INSERT INTO workshop_settings (workshop_id, key, value)
VALUES (1, 'max_quantity_orders_to_seamstress', '3')
ON CONFLICT (workshop_id, key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO orders (order_number, marketplace, order_type, status, sewing_status, product,
                    quantity, source, material, width, height, ym_order_id, workshop_id,
                    cut_at, cutter_user_id, group_key, group_size, group_position)
SELECT 'YMLIM-' || g, 'Yandex', 'FBS', 'Новый', 'Раскроено', 'Вуаль 300x270', 1, 'api',
       'Вуаль', 300, 270, 555555, 1, now(), 1, 'YM-555555', 5, g
FROM generate_series(1, 5) AS g;
