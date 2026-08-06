-- Убираем тестовые данные проверки подбора: сбрасываем связи, чтобы записи не мешали.
UPDATE orders SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый',
                  assigned_user_id = NULL, workshop_id = NULL
WHERE order_number LIKE 'YM-TEST1-%' OR order_number LIKE 'OZ-TEST-%'
   OR order_number LIKE 'WH-TEST-%';

UPDATE goods_warehouse SET reserved_order_id = NULL, matched_at = NULL
WHERE storage_barcode LIKE 'GW-TST%';