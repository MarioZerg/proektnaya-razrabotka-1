-- ТЕСТ: временный новый сотрудник, чтобы проверить замочек на виджете зарплаты.
-- Дата открытия не указана — должна подставиться по умолчанию (сейчас + 14 дней).
INSERT INTO users (login, password_hash, password_salt, full_name, role, workshop, is_active)
VALUES ('test_newbie_lock', 'x', 'x', 'Новичок Тестовый', 'sewer', 'Цех №1', true)
ON CONFLICT (login) DO NOTHING;