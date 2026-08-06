-- Выводим из работы тестового сотрудника проверки кнопки открытия зарплаты.
UPDATE users
SET is_active = false,
    full_name = 'Тестовая запись (проверка замка зарплаты)'
WHERE login = 'test_newbie_lock';