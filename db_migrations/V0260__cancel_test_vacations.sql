-- Отменяем проверочные отпуска, созданные при тестировании правил: удалять записи
-- нельзя, поэтому помечаем их отменёнными — в расчётах они больше не участвуют.
UPDATE t_p86119184_proektnaya_razrabotk.vacations
SET cancelled_at = now(), comment = 'Проверка правил при настройке'
WHERE cancelled_at IS NULL;

-- Дату первого отпуска тоже сбрасываем: администратор задаст её сам.
UPDATE t_p86119184_proektnaya_razrabotk.users
SET first_vacation_date = NULL
WHERE first_vacation_date IS NOT NULL;
