-- Финальное восстановление вещи GW-723759 после проверки новой защиты.
--
-- Последняя проверка (что живая вещь по-прежнему сканируется в короб) снова сбросила
-- ей ярлык и связь с заказом при откате. Вещь физически отстикерована и лежит на
-- складе, отправление 29626990-0586-1 живо на OZON (awaiting_deliver) — возвращаем
-- рабочее состояние окончательно.
UPDATE goods_warehouse
SET status = 'awaiting_supply',
    reserved_order_id = 81586,
    shipping_labeled_at = '2026-08-15 14:10:00.952411',
    matched_at = COALESCE(matched_at, now())
WHERE id = 2169;

UPDATE orders SET fulfilled_from_stock_id = 2169, sewing_status = 'Со склада'
WHERE id = 81586;
