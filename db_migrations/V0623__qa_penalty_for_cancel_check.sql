-- ВРЕМЕННЫЙ ШТРАФ ДЛЯ ПРОВЕРКИ ОТМЕНЫ.
--
-- Проверяем новую кнопку «Отменить штраф» на отдельной записи, а не на боевом
-- штрафе сотрудника: решение о реальных удержаниях принимает администратор, а не
-- проверка. Запись помечена в описании и удаляется следующей миграцией.
INSERT INTO salary_accruals (user_id, type, amount, description, accrued_for, paid_at)
SELECT id, 'penalty', -111.00, 'QA-ПРОВЕРКА отмены штрафа', CURRENT_DATE, now()
FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;
