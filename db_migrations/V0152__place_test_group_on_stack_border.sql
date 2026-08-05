-- Возвращаем рабочие заказы в очередь после тестового захвата стека.
UPDATE orders
SET sewing_status = 'Новый', assigned_user_id = NULL, workshop_id = NULL
WHERE sewing_status = 'На раскрое' AND assigned_user_id = 1 AND cut_at IS NULL
  AND order_number NOT LIKE 'YMTEST-%';

-- Ставим тестовый заказ Яндекса ровно на границу стека закройщика (стек = 20 заказов):
-- перед ним должно оказаться 19 заказов, тогда в стек попадёт только первая его вещь.
-- Так проверяется главное: доберёт ли система остальные вещи заказа, чтобы он не разорвался.
UPDATE orders o
SET created_at = (
    SELECT x.created_at + interval '1 second'
    FROM (
        SELECT created_at, row_number() OVER (ORDER BY created_at ASC, id ASC) AS rn
        FROM orders
        WHERE sewing_status = 'Новый' AND material = 'Вуаль' AND order_type = 'FBS'
          AND group_key IS NULL
    ) x
    WHERE x.rn = 19
)
WHERE o.group_key = 'YM-999999';
