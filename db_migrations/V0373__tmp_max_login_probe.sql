-- Временная учётка для проверки автоподстановки кода при входе через MAX.
-- Удаляется следующей миграцией сразу после проверки.
INSERT INTO users (login, password_hash, password_salt, full_name, role, phone, max_user_id, is_active)
VALUES ('zz_max_probe', 'x', 'x', 'Проверка входа MAX', '', '+79990000001', '999000111', true)
ON CONFLICT (login) DO NOTHING;
