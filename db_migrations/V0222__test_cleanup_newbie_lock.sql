-- Убираем тестового сотрудника проверки замка зарплаты из работы.
UPDATE users SET is_active = false, full_name = 'Тестовая запись (проверка замка зарплаты)'
WHERE login = 'test_newbie_lock';