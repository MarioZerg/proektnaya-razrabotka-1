-- Выводим из оборота тестовые записи проверки тарифа перепаковки.
UPDATE orders SET status = 'Отменён' WHERE order_number LIKE 'RET-TEST-%';

UPDATE goods_warehouse
SET status = 'lost', repack_return_id = NULL, repack_new_bag = NULL,
    lost_reason = 'Тестовая запись проверки тарифа перепаковки', lost_at = now()
WHERE storage_barcode LIKE 'GW-RPK%';