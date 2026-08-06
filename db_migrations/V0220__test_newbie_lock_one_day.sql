-- ТЕСТ: проверяем, что счётчик считает верно и замок снимается сам.
-- Ставим тестовому новичку открытие «завтра» — виджет должен показать 1 день.
UPDATE users SET salary_unlock_at = now() + INTERVAL '20 hours' WHERE login = 'test_newbie_lock';