-- Освобождаем вторую вещь на заказах, которые уже закрыты застикерованным товаром.
--
-- Следы раннего варианта поиска «осиротевших» заказов: вещь привязалась к заказу,
-- который уже держала другая вещь с напечатанным ярлыком. На одно отправление
-- получилось два товара. Оставляем ту, на которой ярлык, вторую возвращаем на полку.
UPDATE goods_warehouse gw
SET status = 'in_stock', reserved_order_id = NULL, matched_at = NULL
WHERE gw.shipping_labeled_at IS NULL
  AND gw.shipped_at IS NULL
  AND gw.reserved_order_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM goods_warehouse other
    WHERE other.reserved_order_id = gw.reserved_order_id
      AND other.id <> gw.id
      AND other.shipped_at IS NULL
      AND other.shipping_labeled_at IS NOT NULL
  );
