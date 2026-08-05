-- Ставим тестовый заказ Яндекса в самое начало очереди закройщика. При стеке в 2 заказа
-- в стек попадут только 2 его вещи из 3 — это и есть проверяемая ситуация: добор группы
-- обязан дотянуть третью вещь, иначе заказ уедет к разным закройщикам.
UPDATE orders
SET sewing_status = 'Новый', assigned_user_id = NULL, workshop_id = NULL
WHERE sewing_status = 'На раскрое' AND assigned_user_id = 1 AND cut_at IS NULL;

UPDATE orders
SET created_at = (SELECT min(created_at) - interval '1 minute' FROM orders WHERE sewing_status = 'Новый')
WHERE group_key = 'YM-999999';
