-- Причина попадания товара на склад хранения: отмена клиентом или ручной приём (возврат)
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS receive_reason VARCHAR(20) DEFAULT 'manual';

COMMENT ON COLUMN goods_warehouse.receive_reason IS 'Причина попадания на склад: cancelled — заказ отменён клиентом (по статусу OZON/WB), return — возврат с маркетплейса, manual — принят вручную';

-- Уже принятые товары от отменённых заказов помечаем соответствующей причиной
UPDATE goods_warehouse g SET receive_reason = 'cancelled'
FROM orders o
WHERE g.order_id = o.id
  AND (o.status = 'Отменён' OR lower(coalesce(o.ozon_status, '')) LIKE '%cancel%');