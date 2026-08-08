-- Возвращаем проверочный рулон на склад: проверка блокировки завершена.
UPDATE t_p86119184_proektnaya_razrabotk.rolls
SET status = 'in_storage', workshop_id = NULL, shift_number = NULL, accepted_at = NULL
WHERE id = 16;
