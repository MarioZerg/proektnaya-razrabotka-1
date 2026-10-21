UPDATE goods_warehouse
SET reserved_order_id = NULL, matched_at = NULL
WHERE id = 19396 AND storage_barcode = 'GW-1490-ZAMENA-15771' AND reserved_order_id = 113193;

UPDATE orders
SET status = 'Новый',
    sewing_status = 'Новый',
    completed_at = NULL,
    assigned_user_id = NULL,
    cutter_user_id = NULL,
    sewer_user_id = NULL,
    packer_user_id = NULL,
    cut_at = NULL,
    taken_at = NULL,
    sewn_at = NULL,
    packed_at = NULL,
    overlocked_at = NULL,
    hanger_number = 0,
    fulfilled_from_stock_id = NULL
WHERE id = 113193 AND order_number = '46319317-0895-1' AND ozon_status = 'awaiting_packaging';

INSERT INTO audit_log (user_name, category, action, entity_type, entity_id, description)
VALUES ('Система', 'orders', 'manual_fix', 'order', 113193,
        'FBS 46319317-0895-1 (Шифон 300x235) вернули в пошив: вещь под него уехала в короб №385 поставки FBO #1490 (запись GW-1490-ZAMENA-15771), а на OZON заказ ждёт сборки с 17.10. Свободного Шифона 300x235 на складе нет — шьём, заказ первый в очереди раскроя по дате.');