-- Проверка границы стека: временно ставим цеху №1 стек = 2 заказа. Тестовый заказ Яндекса
-- из 3 вещей стоит первым в очереди, значит в стек влезут только 2 его вещи — и добор
-- группы обязан дотянуть третью, иначе заказ разорвётся между закройщиками.
UPDATE orders
SET sewing_status = 'Новый', assigned_user_id = NULL, workshop_id = NULL
WHERE sewing_status = 'На раскрое' AND assigned_user_id = 1 AND cut_at IS NULL;

INSERT INTO workshop_settings (workshop_id, key, value)
VALUES (1, 'max_quantity_orders_to_cutter', '2')
ON CONFLICT (workshop_id, key) DO UPDATE SET value = EXCLUDED.value;
