-- Возврат заказа, взятого при проверке доступности ручных заказов швее.
-- Заказ 77857 брали в работу, чтобы убедиться, что блокировка снята.
UPDATE orders
SET sewing_status = 'Раскроено',
    assigned_user_id = NULL,
    taken_at = NULL
WHERE id = 77857 AND sewing_status = 'В работе';
