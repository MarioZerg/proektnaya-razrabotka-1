-- Возвращаем в работу отправления, зависшие в «ожидают сборки».
--
-- Причина: подбор вещи со склада в модулях OZON и WB проставлял резерв, но НЕ менял
-- статус вещи на 'picking'. Списки подбора и счётчик «Ожидают отгрузки» берут только
-- 'picking' и 'awaiting_supply' — поэтому такие отправления не попадали кладовщику
-- вообще и висели неделями. Сам код уже исправлен, здесь чиним накопившееся.
--
-- 1. Три живых отправления (маркетплейс всё ещё ждёт их от нас) — отдаём кладовщику
--    в подбор. Ярлык снимаем: он мог быть напечатан под прежнее, отменённое
--    отправление, и на приёмке вещь с чужой наклейкой не примут.
UPDATE goods_warehouse
SET status = 'picking',
    shipping_labeled_at = NULL,
    shipping_labeled_by = NULL,
    shipping_labeled_by_name = NULL
WHERE id IN (5481, 6256, 6204)
  AND reserved_order_id IS NOT NULL;

-- 2. Заказ 46088218-0296-1 отменён на OZON — собирать его не нужно. Снимаем резерв,
--    вещь возвращается в свободный остаток на полке и достанется другому заказу.
UPDATE goods_warehouse
SET reserved_order_id = NULL,
    matched_at = NULL,
    shipping_labeled_at = NULL,
    shipping_labeled_by = NULL,
    shipping_labeled_by_name = NULL,
    status = 'in_stock'
WHERE id = 5472;

-- Заказ, под который вещь резервировали, больше не считается закрытым со склада.
UPDATE orders
SET fulfilled_from_stock_id = NULL
WHERE id = 89849;