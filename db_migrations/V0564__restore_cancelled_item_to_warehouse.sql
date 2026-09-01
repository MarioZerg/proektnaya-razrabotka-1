-- ВОЗВРАТ ВЕЩИ НА СКЛАД ПОСЛЕ ОШИБОЧНОЙ ОТПРАВКИ В ЦЕХ.
--
-- Заказ 64560283-0368-1 (id 91234) отменён покупателем на OZON, вещь была сшита,
-- упакована и лежала на складе. Кнопкой «В цех» её вернули в пошив: заказ ушёл в
-- статус «В работе», складская запись удалилась. Шить для отменённого покупателя
-- нечего — возвращаем всё как было.
--
-- Вещь получает новый стикер хранения из общего счётчика, статус «на складе» и
-- ждёт на полке заказа с такими же размерами. Заказ переводим обратно в «Готовые».

INSERT INTO goods_warehouse (order_id, storage_barcode, status, receive_reason, received_at)
SELECT 91234,
       'GW-' || lpad(nextval('goods_warehouse_storage_seq')::text, 6, '0'),
       'in_stock',
       'cancelled',
       now()
WHERE NOT EXISTS (SELECT 1 FROM goods_warehouse WHERE order_id = 91234);

UPDATE orders SET sewing_status = 'Готовые' WHERE id = 91234;
