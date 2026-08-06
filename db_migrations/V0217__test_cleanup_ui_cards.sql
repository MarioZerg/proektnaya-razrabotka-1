-- Выводим из оборота тестовые записи проверки мобильных карточек.
UPDATE orders SET status = 'Отменён' WHERE order_number LIKE 'UI-TEST-%';

UPDATE goods_warehouse
SET status = 'lost', shelf_id = NULL,
    lost_reason = 'Тестовая запись проверки мобильной вёрстки', lost_at = now()
WHERE storage_barcode LIKE 'GW-UI%';