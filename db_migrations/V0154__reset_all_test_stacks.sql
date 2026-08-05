-- Полный сброс после серии тестовых захватов: все заказы, взятые тестовым закройщиком и
-- ещё не раскроенные, возвращаются в очередь. Рабочие данные цеха не должны пострадать
-- от проверки.
UPDATE orders
SET sewing_status = 'Новый', assigned_user_id = NULL, workshop_id = NULL
WHERE sewing_status = 'На раскрое' AND assigned_user_id = 1 AND cut_at IS NULL;
