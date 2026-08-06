-- Убираем тестовый заказ проверки разделения материалов по цехам.
UPDATE orders SET status = 'Отменён', sewing_status = 'Новый',
                  assigned_user_id = NULL, workshop_id = NULL, cutter_user_id = NULL
WHERE order_number = 'W2-TEST-01';