-- Убираем проверочные возвраты из счётчика: переводим в обработанные, чтобы они
-- не показывались как ожидающие на ПВЗ. Удалять записи нельзя.
UPDATE t_p86119184_proektnaya_razrabotk.marketplace_returns
SET status = 'processed'
WHERE external_id LIKE 'CHECK-%';
