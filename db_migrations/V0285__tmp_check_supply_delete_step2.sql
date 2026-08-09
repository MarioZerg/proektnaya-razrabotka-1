-- Убираем сшитый заказ из проверочной поставки: проверяем, что без сшитых вещей
-- поставка удаляется вместе с товарным составом.
UPDATE t_p86119184_proektnaya_razrabotk.orders
SET supply_id = NULL
WHERE order_number = 'CHK-DEL-2';
