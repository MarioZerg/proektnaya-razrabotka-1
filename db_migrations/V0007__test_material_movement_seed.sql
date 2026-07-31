INSERT INTO material_movements (material_id, quantity, movement_type, reference)
SELECT id, 5, 'order_usage', 'Тестовый заказ #1' FROM materials WHERE name = 'Вуаль' LIMIT 1;