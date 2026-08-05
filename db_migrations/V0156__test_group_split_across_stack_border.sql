-- Сброс тестового захвата и постановка заказа Яндекса ровно на границу стека: делаем так,
-- чтобы перед ним стояло 19 заказов. Тогда в стек из 20 попадает только его первая вещь,
-- а две другие остаются за границей — именно этот случай проверяет добор группы.
UPDATE orders
SET sewing_status = 'Новый', assigned_user_id = NULL, workshop_id = NULL
WHERE sewing_status = 'На раскрое' AND assigned_user_id = 1 AND cut_at IS NULL;

UPDATE orders o
SET created_at = (
    SELECT x.created_at + interval '1 millisecond'
    FROM (
        SELECT created_at,
               row_number() OVER (ORDER BY (order_type = 'FBS') DESC, created_at ASC, id ASC) AS rn
        FROM orders
        WHERE sewing_status = 'Новый'
          AND material IN ('Вуаль', 'Сетка', 'Бамбук', 'Мрамор', 'Шифон', 'Лен')
          AND group_key IS NULL
    ) x
    WHERE x.rn = 19
)
WHERE o.group_key = 'YM-999999';
