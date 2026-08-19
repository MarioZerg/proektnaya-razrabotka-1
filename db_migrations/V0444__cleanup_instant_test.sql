-- Убираем следы проверки механизма мгновенной выдачи.
--
-- Прогон покупок делался на боевых сотрудниках, поэтому возвращаем им варики,
-- освобождаем выданные сертификаты и помечаем покупки отменёнными. Сами записи
-- не удаляем: история операций с валютой должна оставаться целой.

UPDATE users u
SET variki = COALESCE(u.variki, 0) + p.price
FROM variki_purchases p
JOIN variki_shop_items i ON i.id = p.item_id
WHERE p.user_id = u.id
  AND i.title = 'Поход в кинотеатр'
  AND p.status <> 'cancelled';

UPDATE variki_certificates c
SET purchase_id = NULL, issued_at = NULL
FROM variki_purchases p
JOIN variki_shop_items i ON i.id = p.item_id
WHERE c.purchase_id = p.id
  AND i.title = 'Поход в кинотеатр';

UPDATE variki_purchases p
SET status = 'cancelled',
    cancel_reason = 'Служебная проверка механизма, варики возвращены',
    coupon_url = NULL,
    coupon_name = NULL,
    coupon_at = NULL
FROM variki_shop_items i
WHERE i.id = p.item_id
  AND i.title = 'Поход в кинотеатр'
  AND p.status <> 'cancelled';

-- Тестовые PDF-заглушки в витрине не нужны: админ загрузит настоящие билеты.
UPDATE variki_certificates SET item_id = item_id WHERE false;
