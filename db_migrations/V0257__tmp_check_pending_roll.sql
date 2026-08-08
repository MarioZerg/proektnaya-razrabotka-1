-- Временно ставим рулон 16 в цех как непринятый — проверяем блокировку списания.
UPDATE t_p86119184_proektnaya_razrabotk.rolls
SET status = 'in_workshop', workshop_id = 1, shift_number = 1, accepted_at = NULL
WHERE id = 16;
