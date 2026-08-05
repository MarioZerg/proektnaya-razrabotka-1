-- Дособираем тестовый заказ: кладём в поставку вторую вещь. Теперь заказ полный, и
-- отгрузка должна пройти без блокировки — проверяем, что защита не мешает нормальной работе.
INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id)
SELECT (SELECT id FROM marketplace_supplies WHERE comment = 'ТЕСТ проверки неполного заказа'), gw.id
FROM goods_warehouse gw
JOIN orders o ON o.id = gw.order_id
WHERE o.group_key = 'YM-888888' AND o.group_position = 2
ON CONFLICT DO NOTHING;
