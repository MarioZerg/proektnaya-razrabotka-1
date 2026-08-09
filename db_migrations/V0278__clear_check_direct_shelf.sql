-- Выводим проверочные записи из оборота: проверка прямой укладки на полку прошла.
-- Вещи списываем, чтобы они не попали в подбор заказов, заявки помечаем отклонёнными.
UPDATE t_p86119184_proektnaya_razrabotk.goods_warehouse
SET status = 'written_off', shelf_id = NULL
WHERE storage_barcode IN ('GW-000013', 'GW-000014');

UPDATE t_p86119184_proektnaya_razrabotk.marketplace_returns
SET status = 'rejected'
WHERE external_id LIKE 'CHECK-SHELF-%';
