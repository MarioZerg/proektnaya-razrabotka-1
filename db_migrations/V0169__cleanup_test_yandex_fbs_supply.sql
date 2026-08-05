-- Убираем тестовую поставку Яндекс FBS, созданную при проверке создания. Реальные поставки
-- кладовщик создаст сам из интерфейса.
UPDATE marketplace_supplies
SET status = 'Выполнена', completed_at = now(), comment = 'ТЕСТ создания Яндекс FBS'
WHERE id = 23 AND comment IS NULL;
