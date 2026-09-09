-- Тестовый ключ кладовщика больше не нужен: проверка пройдена.
-- Гасим его сразу, не дожидаясь истечения десяти минут.
UPDATE auth_sessions
SET expires_at = now() - interval '1 day'
WHERE token = 'QA-CHECK-STOREKEEPER-TOKEN-0001';
