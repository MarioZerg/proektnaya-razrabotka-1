-- Дата, когда заказ получил статус отмены на маркетплейсе.
--
-- Кладовщик, принимая возврат, должен видеть, когда покупатель отказался: свежий отказ
-- и отказ месячной давности — разные истории. Раньше эту дату было негде взять: статус
-- перезаписывался синхронизацией, а момент смены нигде не фиксировался.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

COMMENT ON COLUMN orders.cancelled_at IS
    'Когда заказ получил статус отмены на маркетплейсе (фиксируется синхронизацией)';

-- Уже отменённым заказам проставляем дату создания: точнее данных нет, но это лучше,
-- чем пустая ячейка в карточке возврата.
UPDATE orders SET cancelled_at = created_at
WHERE cancelled_at IS NULL
  AND (COALESCE(ozon_status, '') LIKE 'cancel%' OR COALESCE(ym_status, '') LIKE 'cancel%');
