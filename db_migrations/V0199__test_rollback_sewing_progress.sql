-- Возвращаем тестовые изделия в исходное состояние, чтобы убрать проверочную поставку.
UPDATE orders SET sewing_status = 'Новый', status = 'Новый' WHERE supply_id = 35;