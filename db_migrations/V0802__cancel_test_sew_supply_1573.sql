UPDATE t_p86119184_proektnaya_razrabotk.goods_warehouse
SET reserved_order_id = NULL, matched_at = NULL
WHERE reserved_order_id IN (SELECT id FROM t_p86119184_proektnaya_razrabotk.orders WHERE supply_id = 1573 AND source = 'proposal')
  AND status = 'in_stock';

UPDATE t_p86119184_proektnaya_razrabotk.orders
SET status = 'Отменён', cancelled_at = now(), fulfilled_from_stock_id = NULL
WHERE supply_id = 1573 AND source = 'proposal'
  AND sewing_status IN ('Новый', 'Со склада')
  AND cut_at IS NULL AND taken_at IS NULL;

UPDATE t_p86119184_proektnaya_razrabotk.marketplace_supplies
SET status = 'Отменена', comment = 'Тестовый прогон автопредложки пошива — отменена сразу, в работу не шла'
WHERE id = 1573;

UPDATE t_p86119184_proektnaya_razrabotk.sew_supply_plans SET status = 'cancelled' WHERE supply_id = 1573;