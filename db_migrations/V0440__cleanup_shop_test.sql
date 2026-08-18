-- Убираем следы проверки механизма магазина.
--
-- Служебная позиция «Проверка магазина» и покупка по ней были нужны только для
-- прогона цикла (покупка → купон → выдача). Возвращаем сотруднику списанный
-- варик и прячем позицию из витрины. Записи о покупке оставляем помеченной
-- отменённой, а не удаляем: история операций с валютой должна быть целой.

UPDATE users u
SET variki = COALESCE(u.variki, 0) + p.price
FROM variki_purchases p
JOIN variki_shop_items i ON i.id = p.item_id
WHERE p.user_id = u.id
  AND i.title = 'Проверка магазина'
  AND p.status <> 'cancelled';

UPDATE variki_purchases p
SET status = 'cancelled',
    cancel_reason = 'Служебная проверка механизма, варики возвращены'
FROM variki_shop_items i
WHERE i.id = p.item_id
  AND i.title = 'Проверка магазина'
  AND p.status <> 'cancelled';

UPDATE variki_shop_items SET is_active = false WHERE title = 'Проверка магазина';
