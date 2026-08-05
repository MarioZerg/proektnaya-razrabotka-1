-- Возврат #1 обрабатывался при отладке — возвращаем его в состояние «одобрен, едет к нам»,
-- чтобы кладовщик принял его штатно.
UPDATE marketplace_returns
SET status = 'approved', outcome = NULL, outcome_at = NULL, outcome_by = NULL,
    received_at = NULL, received_by = NULL, goods_warehouse_id = NULL
WHERE id = 1;
