UPDATE goods_warehouse
SET status = 'in_stock', reserved_order_id = NULL, matched_at = NULL
WHERE id = 18013 AND reserved_order_id = 115349 AND status = 'picking';

UPDATE orders
SET fulfilled_from_stock_id = NULL,
    status = 'Отменён',
    sewing_status = 'Отменён',
    cancelled_at = now(),
    supply_id = NULL
WHERE supply_id = 1490
  AND order_number LIKE '2000070845299%'
  AND status = 'Новый'
  AND created_at >= '2026-10-18 19:20:00'
  AND created_at < '2026-10-18 19:21:00';

INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description)
VALUES (NULL, 'Система', 'integration', 'ozon_fbo_import_rollback', 'supply', 1490,
        'Откат ошибочной загрузки состава заявки 2000070845299: 215 лишних заказов отменены и убраны из поставки, вещь GW 18013 возвращена на полку');