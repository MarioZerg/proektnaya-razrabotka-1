-- ПРОВЕРКА поведения при двух сменах за один день. Пишем РЕАЛЬНО в salary_accruals
-- тем же способом, что и система (ON CONFLICT по смене), но с нулевой суммой, чтобы
-- ничего никому не начислить. Сразу после проверки строки удаляются (см. следующую
-- миграцию — она снимет тестовые записи по описанию).
-- Смысл: у двух смен разные id, поэтому ON CONFLICT по смене не срабатывает, и
-- проверить нужно, остановит ли вставку ДНЕВНОЙ уникальный индекс.
INSERT INTO salary_accruals (user_id, type, amount, shift_session_id, description)
VALUES (8, 'cleaner_shift', 0, 13, 'ПРОВЕРКА-ДУБЛЯ смена 1')
ON CONFLICT (shift_session_id, type) WHERE shift_session_id IS NOT NULL DO NOTHING;