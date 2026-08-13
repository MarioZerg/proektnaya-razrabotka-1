-- Снимаем с подбора вещи, чьи отправления маркетплейс уже считает собранными.
--
-- Отправление в статусе «ожидает отгрузки» (awaiting_deliver) и дальше OZON считает
-- собранным: ярлык на него больше не выдаётся, отсканировать вещь в поставку нельзя,
-- и по конвейеру она не пройдёт — упаковщице просто нечего печатать.
--
-- Такие заказы попадали в подбор из-за того, что автоподбор не смотрел на статус
-- отправления. Кладовщик шёл за товаром к стеллажу и упирался в тупик на стикеровке.
--
-- Вещь возвращаем в свободный остаток: она цела, лежит на своей полке и закроет
-- собой следующий заказ. Полку не трогаем — физически вещь никуда не переезжала.
UPDATE goods_warehouse gw
SET status = 'in_stock',
    reserved_order_id = NULL,
    matched_at = NULL
WHERE gw.status = 'picking'
  AND gw.shipping_labeled_at IS NULL
  AND EXISTS (
      SELECT 1 FROM orders ro
      WHERE ro.id = gw.reserved_order_id
        AND COALESCE(ro.ozon_status, '') IN (
            'awaiting_deliver', 'delivering', 'delivered',
            'cancelled', 'not_accepted', 'driver_pickup'
        )
  );

-- Заказы этих отправлений возвращаем в производство: раз складом их не закрыть,
-- вещь надо сшить заново.
UPDATE orders o
SET fulfilled_from_stock_id = NULL,
    sewing_status = 'Новый',
    assigned_user_id = NULL
WHERE o.sewing_status = 'Со склада'
  AND COALESCE(o.ozon_status, '') IN (
      'awaiting_deliver', 'delivering', 'delivered',
      'cancelled', 'not_accepted', 'driver_pickup'
  )
  AND NOT EXISTS (
      SELECT 1 FROM goods_warehouse g
      WHERE g.reserved_order_id = o.id
        AND g.shipping_labeled_at IS NOT NULL
  );
