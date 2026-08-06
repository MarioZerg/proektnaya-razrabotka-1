-- ТЕСТ кнопки досрочного открытия зарплаты: возвращаем тестовому сотруднику
-- закрытую зарплату на 14 дней и делаем его активным на время проверки.
UPDATE users
SET salary_unlock_at = now() + INTERVAL '14 days',
    is_active = true,
    full_name = 'Новичок Тестовый'
WHERE login = 'test_newbie_lock';