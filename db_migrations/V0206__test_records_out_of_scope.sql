-- Выводим тестовые записи проверки подбора из оборота: заказы помечаем отменёнными,
-- складские вещи — списанными. В подборе, очереди раскроя и остатках они не участвуют
-- (везде стоят фильтры по статусу). Физически удалить их можно только через раздел базы.
UPDATE orders SET status = 'Отменён'
WHERE order_number LIKE 'YM-TEST1-%' OR order_number LIKE 'OZ-TEST-%'
   OR order_number LIKE 'WH-TEST-%';

UPDATE goods_warehouse
SET status = 'lost', lost_reason = 'Тестовая запись проверки подбора', lost_at = now()
WHERE storage_barcode LIKE 'GW-TST%';