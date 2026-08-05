-- Финальный сброс перед чистой проверкой групповой выдачи.
UPDATE orders
SET sewing_status = 'Новый', assigned_user_id = NULL, workshop_id = NULL
WHERE sewing_status = 'На раскрое' AND assigned_user_id = 1 AND cut_at IS NULL;
