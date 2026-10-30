UPDATE t_p86119184_proektnaya_razrabotk.goods_warehouse
SET status = 'lost', shelf_id = NULL, reserved_order_id = NULL, matched_at = NULL,
    lost_reason = 'Удалено по решению владельца: неопознанный излишек OZON (FBO-вывоз 20271184872), ошибочно заведён на склад',
    lost_at = now()
WHERE id = 21630 AND status = 'repacking';

UPDATE t_p86119184_proektnaya_razrabotk.orders
SET status = 'Отменён', cancelled_at = COALESCE(cancelled_at, now())
WHERE id = 123558 AND order_number = 'RET-OZON-RM-715303-20271184872';

UPDATE t_p86119184_proektnaya_razrabotk.marketplace_returns
SET outcome = 'removed', outcome_at = now(), damage_note = 'Удалено: неопознанный излишек, ошибочная запись'
WHERE id = 6858;