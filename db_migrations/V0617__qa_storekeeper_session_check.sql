-- Временная сессия кладовщика для проверки защиты.
--
-- Заводим настоящий ключ реального кладовщика и пробуем им списать материал:
-- одно дело — что запрос без ключа отклоняется, и совсем другое — что с
-- настоящим ключом кладовщика система тоже говорит «нет». Проверять защиту
-- надо именно так, иначе легко пропустить дыру.
--
-- Ключ живёт 10 минут и потом протухает сам.
INSERT INTO auth_sessions (token, user_id, role, expires_at)
VALUES ('QA-CHECK-STOREKEEPER-TOKEN-0001', 30, 'storekeeper', now() + interval '10 minutes')
ON CONFLICT (token) DO UPDATE SET expires_at = now() + interval '10 minutes';
