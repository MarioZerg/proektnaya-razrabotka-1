-- ТЕСТОВЫЕ ВОЗВРАТЫ ДЛЯ ПРОВЕРКИ ПЕРЕПАКОВКИ.
--
-- Три вещи на перепаковке в тестовом цехе (id 7) + рулон под возврат материала.
-- Проверяем три исхода: годна → на склад, брак → на утилизацию, распустить на
-- материал → в рулон. Плюс гонки и повторные нажатия.
--
-- Всё привязано к тестовым заказам QA-TEST-ORD-*, боевых данных не касается.

-- Рабочий рулон под возврат материала (тестовые закрыты предыдущей проверкой).
INSERT INTO rolls (barcode, material_id, workshop_id, shift_number,
                   initial_quantity, remaining_quantity, status, accepted_at,
                   cost_per_unit, shortage_norm_percent)
VALUES ('QA-TEST-LEN-4', 2, 7, 1, 100.000, 40.000, 'in_workshop', now(), 100.0000, 2.000)
ON CONFLICT (barcode) DO NOTHING;

-- Складские вещи по тестовым заказам, переведённые на перепаковку.
INSERT INTO goods_warehouse (order_id, storage_barcode, status, received_at, storage_labeled_at)
SELECT o.id,
       'QA-GW-' || o.id,
       'repacking',
       now(),
       now()
FROM orders o
WHERE o.order_number IN ('QA-TEST-ORD-1', 'QA-TEST-ORD-2', 'QA-TEST-ORD-3')
  AND NOT EXISTS (
    SELECT 1 FROM goods_warehouse gw WHERE gw.storage_barcode = 'QA-GW-' || o.id
  );

-- Заявки возврата с маркетплейса: по ним упаковщица сканирует вещь.
INSERT INTO marketplace_returns (marketplace, external_id, posting_number, order_id,
                                 product_name, quantity, status, goods_warehouse_id,
                                 return_reason, return_barcode, received_at)
SELECT 'OZON',
       'QA-RET-' || o.id,
       o.order_number,
       o.id,
       o.product,
       1,
       'received',
       gw.id,
       'Тестовая проверка перепаковки',
       'QA-RETBC-' || o.id,
       now()
FROM orders o
JOIN goods_warehouse gw ON gw.storage_barcode = 'QA-GW-' || o.id
WHERE o.order_number IN ('QA-TEST-ORD-1', 'QA-TEST-ORD-2', 'QA-TEST-ORD-3')
  AND NOT EXISTS (
    SELECT 1 FROM marketplace_returns mr WHERE mr.external_id = 'QA-RET-' || o.id
  );

-- Связываем вещь с заявкой возврата: так работает реальный поток перепаковки.
UPDATE goods_warehouse gw
SET repack_return_id = mr.id
FROM marketplace_returns mr
WHERE mr.goods_warehouse_id = gw.id
  AND mr.external_id LIKE 'QA-RET-%';
