-- Сбрасываем дату первого отпуска после проверки: администратор задаст её сам,
-- оформив реальный отпуск. Тестовые записи уже отменены.
UPDATE t_p86119184_proektnaya_razrabotk.users
SET first_vacation_date = NULL
WHERE first_vacation_date IS NOT NULL;
