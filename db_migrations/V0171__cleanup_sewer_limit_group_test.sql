-- Проверка пройдена: швея взяла все 5 вещей заказа Яндекса при лимите 3, но 6-й посторонний
-- заказ система не выдала — исключение работает только на догрузку начатой связки и не даёт
-- набрать лишней работы. Убираем тестовые заказы и возвращаем боевой лимит цеха.
UPDATE orders SET status = 'Отменён', sewing_status = 'Отменён', assigned_user_id = NULL
WHERE group_key = 'YM-555555';

UPDATE workshop_settings SET value = '10'
WHERE workshop_id = 1 AND key = 'max_quantity_orders_to_seamstress';
