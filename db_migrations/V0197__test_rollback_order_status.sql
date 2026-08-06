-- Возвращаем тестовый заказ в исходное состояние после проверки защиты от удаления.
UPDATE orders SET sewing_status = 'Новый' WHERE order_number = '00000-01';