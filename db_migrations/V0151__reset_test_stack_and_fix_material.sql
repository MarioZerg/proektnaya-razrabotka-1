-- Откат тестового захвата стека: возвращаем реальные заказы в очередь «Новый», чтобы
-- проверка групповой логики не задела рабочие данные цеха.
UPDATE orders
SET sewing_status = 'Новый', assigned_user_id = NULL, workshop_id = NULL
WHERE sewing_status = 'На раскрое'
  AND assigned_user_id = 1
  AND cut_at IS NULL
  AND order_number NOT LIKE 'YMTEST-%';

-- Тестовый заказ Яндекса переводим на материал, разрешённый цеху №1, — иначе закройщик
-- физически не может его взять и групповую выдачу не проверить.
UPDATE orders SET material = 'Вуаль', product = 'Вуаль 300x270'
WHERE group_key = 'YM-999999';
