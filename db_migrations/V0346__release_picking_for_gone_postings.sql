-- Снимаем резерв с вещей, чьё отправление уже уехало от нас или отменено.
--
-- Система подобрала эти вещи под заказы, но заказы к тому моменту уже ушли к покупателю
-- (delivering/delivered), были отменены или переданы водителю. Ярлык для них OZON больше
-- не отдаёт: кладовщик шёл к стеллажу, жал «Напечатать стикер FBS» и получал
-- «OZON готовит этикетку, нажмите ещё раз» — по кругу, без всякого результата.
--
-- Возвращаем вещи на полку и снимаем резерв: физически они лежат на складе и годны к
-- продаже, просто конкретно этот заказ ими уже не закрыть. Автоподбор при следующем
-- запуске подберёт их под живые заказы.
UPDATE goods_warehouse gw
SET status = 'in_stock',
    reserved_order_id = NULL,
    matched_at = NULL
FROM orders o
WHERE o.id = gw.reserved_order_id
  AND gw.status = 'picking'
  AND gw.shipping_labeled_at IS NULL
  AND o.ozon_status IN ('delivering', 'delivered', 'cancelled', 'not_accepted', 'driver_pickup');
