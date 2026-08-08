-- Сбрасываем дату первого отпуска после проверки календаря: её задаст администратор,
-- оформив реальный отпуск сотруднику.
UPDATE t_p86119184_proektnaya_razrabotk.users
SET first_vacation_date = NULL
WHERE first_vacation_date IS NOT NULL;
