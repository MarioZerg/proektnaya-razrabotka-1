-- Снимаем ярлыки отправлений, напечатанные под ЧУЖОЙ (в том числе отменённый) заказ.
--
-- Вещь стикеруют под конкретное отправление. Если это отправление потом отменили
-- на маркетплейсе, вещь возвращается в свободный остаток и подбирается под новый
-- заказ — но отметка «ярлык наклеен» на ней оставалась. Из-за этого сканер подбора
-- отвечал «стикер уже наклеен, неси в короб», хотя на пакете висела наклейка
-- отменённого заказа: на приёмке маркетплейса такую вещь не принимают.
--
-- Признак порчи — ярлык напечатан РАНЬШЕ, чем вещь привязали к текущему заказу
-- (matched_at > shipping_labeled_at). Значит наклейка осталась от прошлой жизни вещи.
--
-- Вещи, уже уехавшие (shipped_at) или лежащие в живой поставке, НЕ трогаем: они
-- физически в коробе, там своя наклейка и своя история.
UPDATE t_p86119184_proektnaya_razrabotk.goods_warehouse gw
SET shipping_labeled_at = NULL,
    shipping_labeled_by = NULL,
    shipping_labeled_by_name = NULL,
    status = CASE WHEN gw.status = 'awaiting_supply' THEN 'picking' ELSE gw.status END
WHERE gw.shipping_labeled_at IS NOT NULL
  AND gw.shipped_at IS NULL
  AND gw.matched_at IS NOT NULL
  AND gw.matched_at > gw.shipping_labeled_at
  AND NOT EXISTS (
        SELECT 1 FROM t_p86119184_proektnaya_razrabotk.marketplace_supply_items msi
        JOIN t_p86119184_proektnaya_razrabotk.marketplace_supplies ms ON ms.id = msi.supply_id
        WHERE msi.goods_warehouse_id = gw.id
          AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')
  );

-- Вещи, сшитые под ОТМЕНЁННЫЙ заказ и не подобранные заново: возвращаем на полку
-- свободным остатком. Наклейка отменённого отправления на них недействительна,
-- а числиться «собранными» они не должны — иначе просто выпадают из оборота.
UPDATE t_p86119184_proektnaya_razrabotk.goods_warehouse gw
SET shipping_labeled_at = NULL,
    shipping_labeled_by = NULL,
    shipping_labeled_by_name = NULL,
    status = 'in_stock',
    reserved_order_id = NULL,
    matched_at = NULL
FROM t_p86119184_proektnaya_razrabotk.orders so
WHERE so.id = gw.order_id
  AND gw.reserved_order_id IS NULL
  AND gw.shipped_at IS NULL
  AND gw.shipping_labeled_at IS NOT NULL
  AND (so.ozon_status IN ('cancelled', 'not_accepted') OR so.status = 'Отменён')
  AND NOT EXISTS (
        SELECT 1 FROM t_p86119184_proektnaya_razrabotk.marketplace_supply_items msi
        JOIN t_p86119184_proektnaya_razrabotk.marketplace_supplies ms ON ms.id = msi.supply_id
        WHERE msi.goods_warehouse_id = gw.id
          AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')
  );
