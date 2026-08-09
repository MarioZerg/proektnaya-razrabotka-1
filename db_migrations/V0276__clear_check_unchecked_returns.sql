-- Выводим проверочные возвраты из оборота: проверка блока «непроверенные» прошла,
-- в рабочих счётчиках этих записей быть не должно. Удаление данных запрещено,
-- поэтому помечаем их отклонёнными.
UPDATE t_p86119184_proektnaya_razrabotk.marketplace_returns
SET status = 'rejected'
WHERE external_id LIKE 'CHECK-UNCHK-%';
