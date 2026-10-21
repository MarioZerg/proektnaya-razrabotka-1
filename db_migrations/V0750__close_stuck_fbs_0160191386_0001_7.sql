UPDATE orders
SET status = 'Отгружен', sewing_status = 'Готовые',
    packer_user_id = 46, packed_at = '2026-10-18 17:58:41',
    completed_at = '2026-10-19 09:07:48'
WHERE id = 114655 AND order_number = '0160191386-0001-7' AND sewing_status = 'Стикеровка';

INSERT INTO goods_warehouse (order_id, reserved_order_id, status, received_at, shipped_at, storage_barcode,
                             receive_reason, shipping_labeled_at, matched_at)
SELECT 114655, 114655, 'shipped', '2026-10-18 17:58:41', '2026-10-19 09:07:48', 'GW-FIX-114655',
       'fbs_ready', '2026-10-18 17:58:41', now()
WHERE NOT EXISTS (SELECT 1 FROM goods_warehouse WHERE order_id = 114655);

INSERT INTO salary_accruals (user_id, type, amount, accrued_for, order_id, description)
SELECT 46, 'sewer_piece', 51, '2026-10-18', 114655, 'Пошив заказа #0160191386-0001-7 (200 см)'
WHERE NOT EXISTS (SELECT 1 FROM salary_accruals WHERE order_id = 114655 AND type = 'sewer_piece');

INSERT INTO salary_accruals (user_id, type, amount, accrued_for, order_id, description)
SELECT 46, 'packer_stickering', 8, '2026-10-18', 114655,
       'Стикеровка заказа #0160191386-0001-7 - 2.0 п.м. (стикеровал швея вместо упаковщицы)'
WHERE NOT EXISTS (SELECT 1 FROM salary_accruals WHERE order_id = 114655 AND type = 'packer_stickering');

INSERT INTO audit_log (user_name, category, action, entity_type, entity_id, description)
VALUES ('Система', 'production', 'manual_fix', 'order', 114655,
        'Заказ 0160191386-0001-7 закрыт задним числом: Беляева Наталия сшила его вместе с -3, ярлык OZON напечатан и вещь уехала (OZON: в доставке с 19.10), но «Закрыть заказ» на терминале не нажато. Начислены пошив 51 ₽ и стикеровка 8 ₽.');