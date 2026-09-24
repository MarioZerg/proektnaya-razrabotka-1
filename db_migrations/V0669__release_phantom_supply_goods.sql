-- Освобождаем вещи, которые числятся занятыми под поставку, но ни в одной
-- живой поставке не лежат. Это двойники: их заказ уже уложен в короб другой
-- вещью, а эти остались висеть и попадались кладовщику на полке.
-- Состав поставок НЕ трогаем: marketplace_supply_items не меняется.

UPDATE t_p86119184_proektnaya_razrabotk.goods_warehouse g
SET status = 'in_stock',
    shipping_labeled_at = NULL,
    shipping_labeled_by = NULL,
    shipping_labeled_by_name = NULL,
    reserved_order_id = NULL,
    matched_at = NULL
WHERE g.shipped_at IS NULL
  AND g.status IN ('awaiting_supply', 'picking')
  AND NOT EXISTS (
        SELECT 1 FROM t_p86119184_proektnaya_razrabotk.marketplace_supply_items si
        JOIN t_p86119184_proektnaya_razrabotk.marketplace_supplies ms ON ms.id = si.supply_id
        WHERE si.goods_warehouse_id = g.id
          AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена'))
  AND EXISTS (
        SELECT 1 FROM t_p86119184_proektnaya_razrabotk.marketplace_supply_items si2
        JOIN t_p86119184_proektnaya_razrabotk.marketplace_supplies ms2 ON ms2.id = si2.supply_id
        JOIN t_p86119184_proektnaya_razrabotk.goods_warehouse g2 ON g2.id = si2.goods_warehouse_id
        WHERE COALESCE(ms2.status, '') NOT IN ('Выполнена', 'Отменена')
          AND COALESCE(g2.reserved_order_id, g2.order_id)
              = COALESCE(g.reserved_order_id, g.order_id));
