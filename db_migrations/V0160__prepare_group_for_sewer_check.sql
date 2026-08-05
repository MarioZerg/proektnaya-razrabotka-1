-- Готовим проверку выдачи заказа швее: тестовый заказ Яндекса переводим в «Раскроено»
-- (как будто закройщик его раскроил), чтобы он попал в очередь пошива.
UPDATE orders
SET sewing_status = 'Раскроено', cut_at = now(), cutter_user_id = 1, workshop_id = 1
WHERE group_key = 'YM-999999';

-- Остальные заказы, взятые тестовым закройщиком, возвращаем в очередь.
UPDATE orders
SET sewing_status = 'Новый', assigned_user_id = NULL, workshop_id = NULL
WHERE sewing_status = 'На раскрое' AND assigned_user_id = 1 AND cut_at IS NULL;
