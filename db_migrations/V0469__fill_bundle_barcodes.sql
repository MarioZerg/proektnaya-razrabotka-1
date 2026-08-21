-- Проставляем стикеры связок вещам, которые уже застикерованы.
--
-- Код выдаётся при стикеровке, но вещи связок, отстикерованные ДО появления
-- этого механизма, остались без него — и собрать их в поставку было бы нечем.
--
-- Код повторяет номер заказа и позицию вещи: «YM-60603398529-2». По нему сразу
-- видно, из какой связки вещь и какая она по счёту — это читается и глазами,
-- без сканера.
UPDATE goods_warehouse gw
SET bundle_barcode = o.group_key || '-' || COALESCE(o.group_position, 1)
FROM orders o
WHERE o.id = COALESCE(gw.reserved_order_id, gw.order_id)
  AND o.group_key IS NOT NULL
  AND COALESCE(o.group_size, 1) > 1
  AND gw.bundle_barcode IS NULL
  AND gw.shipped_at IS NULL;
