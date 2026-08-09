-- Убираем заказы, ошибочно загруженные как новые.
--
-- Статус awaiting_deliver у OZON означает, что отправление УЖЕ СОБРАНО и ждёт
-- передачи в доставку — шить там нечего. Я ошибочно добавил этот статус в загрузку,
-- и в цех прилетело 469 лишних заданий.
--
-- Удаляем только те, что созданы этой загрузкой, не тронуты человеком и не имеют
-- связей: ничего из реальной работы не пострадает.
UPDATE orders
SET status = 'Отменён',
    sewing_status = 'Отменён'
WHERE marketplace = 'OZON'
  AND ozon_status = 'awaiting_deliver'
  AND sewing_status = 'Новый'
  AND assigned_user_id IS NULL
  AND cutter_user_id IS NULL
  AND sewer_user_id IS NULL
  AND packer_user_id IS NULL
  AND created_at > now() - interval '2 hours';
