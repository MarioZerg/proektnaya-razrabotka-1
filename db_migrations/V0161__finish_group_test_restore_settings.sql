-- Проверка групповой выдачи завершена успешно: закройщик берёт заказ Яндекса целиком даже
-- на границе стека, а швея получает все вещи заказа подряд. Тестовый заказ выводим из
-- работы (помечаем отменённым, чтобы он не мешал в цеху) и возвращаем боевой размер стека.
UPDATE orders
SET sewing_status = 'Отменён', status = 'Отменён', assigned_user_id = NULL
WHERE group_key = 'YM-999999';

UPDATE workshop_settings SET value = '20'
WHERE workshop_id = 1 AND key = 'max_quantity_orders_to_cutter';
