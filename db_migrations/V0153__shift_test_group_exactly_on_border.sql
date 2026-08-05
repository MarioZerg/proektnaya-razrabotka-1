-- Возвращаем рабочие заказы в очередь после очередного тестового захвата стека.
UPDATE orders
SET sewing_status = 'Новый', assigned_user_id = NULL, workshop_id = NULL
WHERE sewing_status = 'На раскрое' AND assigned_user_id = 1 AND cut_at IS NULL
  AND order_number NOT LIKE 'YMTEST-%';

-- Сдвигаем тестовый заказ Яндекса на одну позицию раньше, чтобы он встал ровно на 20-е
-- место — последнее в стеке. Тогда в стек попадает только первая его вещь, а две другие
-- остаются за границей: ровно тот случай, ради которого сделан добор группы.
UPDATE orders o
SET created_at = (
    SELECT x.created_at - interval '1 second'
    FROM (
        SELECT created_at, row_number() OVER (ORDER BY created_at ASC, id ASC) AS rn
        FROM orders
        WHERE sewing_status = 'Новый' AND material = 'Вуаль' AND order_type = 'FBS'
          AND group_key IS NULL
    ) x
    WHERE x.rn = 20
)
WHERE o.group_key = 'YM-999999';
