-- Ставим проверочный рулон в цех: нужно убедиться, что кладовщик забирает
-- бракованный рулон сканером именно из цеха, а не со склада.
UPDATE t_p86119184_proektnaya_razrabotk.rolls
SET status = 'in_workshop',
    workshop_id = (SELECT id FROM t_p86119184_proektnaya_razrabotk.workshops ORDER BY id LIMIT 1),
    shift_number = 1,
    accepted_at = now()
WHERE id = 10;
