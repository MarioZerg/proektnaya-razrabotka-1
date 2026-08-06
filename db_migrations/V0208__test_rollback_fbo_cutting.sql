-- Возвращаем тестовые заказы из раскроя, чтобы удалить проверочную поставку
-- и заодно убедиться, что зарезервированная с полки вещь освободится.
UPDATE orders SET sewing_status = 'Новый', assigned_user_id = NULL, workshop_id = NULL
WHERE supply_id = 36 AND sewing_status = 'На раскрое';