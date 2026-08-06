-- Выводим из оборота тестовые записи проверки резерва FBO.
UPDATE orders SET status = 'Отменён' WHERE order_number LIKE 'WH-FBO-%';

UPDATE goods_warehouse
SET status = 'lost', reserved_order_id = NULL,
    lost_reason = 'Тестовая запись проверки резерва FBO', lost_at = now()
WHERE storage_barcode LIKE 'GW-FBO%' AND status <> 'lost';