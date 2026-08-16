-- Возврат в оборот вещей, зависших под отменёнными заказами OZON.
--
-- Ситуация: заказ отменили на маркетплейсе уже после того, как вещь сшили и
-- застикеровали. Заказ мы с конвейера НЕ снимаем — он доводится до конца, это
-- рабочее правило. Но сама вещь при этом остаётся числиться «в сборке» под
-- отменённое отправление: в поставку она не уедет (на приёмке ярлык отменённого
-- заказа не примут), а свободным остатком не считается — и выпадает из оборота.
--
-- Заказы этой миграцией НЕ ТРОГАЕМ вообще: ни статус, ни sewing_status. Работаем
-- только с физической вещью — снимаем ярлык недействительного отправления и
-- возвращаем её в свободный остаток, чтобы её подобрали под нового покупателя.
--
-- Строго исключаем:
--   * вещи, закреплённые за ЖИВЫМ заказом (reserved_order_id ведёт на неотменённый) —
--     они уже едут новому покупателю, их трогать нельзя;
--   * вещи, лежащие в живой поставке (короб уже собран);
--   * отгруженные (shipped_at) — они физически уехали.

-- 1. Вещи, у которых полка известна: возвращаем прямо на хранение свободным остатком.
UPDATE t_p86119184_proektnaya_razrabotk.goods_warehouse gw
SET status = 'in_stock',
    reserved_order_id = NULL,
    matched_at = NULL,
    shipping_labeled_at = NULL,
    shipping_labeled_by = NULL,
    shipping_labeled_by_name = NULL
WHERE gw.id IN (1788)
  AND gw.shipped_at IS NULL
  AND gw.shelf_id IS NOT NULL
  AND NOT EXISTS (
        SELECT 1 FROM t_p86119184_proektnaya_razrabotk.marketplace_supply_items msi
        JOIN t_p86119184_proektnaya_razrabotk.marketplace_supplies ms ON ms.id = msi.supply_id
        WHERE msi.goods_warehouse_id = gw.id
          AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')
  );

-- 2. Вещи без полки: отправляем на раскладку («Осмотрено»). Кладовщик отсканирует
--    их на полку обычным путём — так система будет знать, где вещь физически лежит.
--    Ставить им in_stock без полки нельзя: вещь числилась бы на складе «нигде».
UPDATE t_p86119184_proektnaya_razrabotk.goods_warehouse gw
SET status = 'inspected',
    reserved_order_id = NULL,
    matched_at = NULL,
    shipping_labeled_at = NULL,
    shipping_labeled_by = NULL,
    shipping_labeled_by_name = NULL
WHERE gw.id IN (2376, 2470, 2472, 2505, 2506)
  AND gw.shipped_at IS NULL
  AND gw.shelf_id IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM t_p86119184_proektnaya_razrabotk.marketplace_supply_items msi
        JOIN t_p86119184_proektnaya_razrabotk.marketplace_supplies ms ON ms.id = msi.supply_id
        WHERE msi.goods_warehouse_id = gw.id
          AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')
  );

-- 3. Убираем обратную ссылку у отменённых заказов: заказ больше не закрыт этой вещью.
--    Сам заказ остаётся как есть — с конвейера его не снимаем.
UPDATE t_p86119184_proektnaya_razrabotk.orders o
SET fulfilled_from_stock_id = NULL
WHERE o.fulfilled_from_stock_id IN (1788, 2376, 2470, 2472, 2505, 2506)
  AND COALESCE(o.ozon_status, '') LIKE 'cancel%';
