-- Откат следов проверки подмены вещей.
--
-- При проверке нового поведения были отстикерованы две вещи (GW-002762 и
-- GW-723436), которых кладовщик в руках не держал. Ярлык на них не печатали,
-- физически они лежат на полке — возвращаем резерв на те вещи, что выбрал
-- автоподбор, иначе кладовщик пойдёт искать не тот товар.
UPDATE goods_warehouse
SET reserved_order_id = NULL, matched_at = NULL,
    shipping_labeled_at = NULL, shipping_labeled_by = NULL,
    shipping_labeled_by_name = NULL, status = 'in_stock'
WHERE id IN (2762, 1814);

UPDATE goods_warehouse
SET reserved_order_id = 87167, matched_at = now(), status = 'in_stock'
WHERE id = 692;

UPDATE goods_warehouse
SET reserved_order_id = 87171, matched_at = now(), status = 'in_stock'
WHERE id = 1714;

UPDATE orders SET fulfilled_from_stock_id = 692 WHERE id = 87167;
UPDATE orders SET fulfilled_from_stock_id = 1714 WHERE id = 87171;
