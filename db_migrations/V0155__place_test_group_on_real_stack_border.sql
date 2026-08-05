-- Ставим тестовый заказ Яндекса ровно на 20-ю позицию общей очереди закройщика (стек = 20).
-- Очередь считается по ВСЕМ материалам, разрешённым цеху, а не по одному — поэтому берём
-- время 20-го заказа в общей очереди и встаём на секунду раньше. Тогда в стек попадёт лишь
-- часть вещей заказа, и проверится главное — доберёт ли система остальные.
UPDATE orders o
SET created_at = (
    SELECT x.created_at - interval '1 second'
    FROM (
        SELECT created_at,
               row_number() OVER (ORDER BY (order_type = 'FBS') DESC, created_at ASC, id ASC) AS rn
        FROM orders
        WHERE sewing_status = 'Новый'
          AND material IN ('Вуаль', 'Сетка', 'Бамбук', 'Мрамор', 'Шифон', 'Лен')
          AND group_key IS NULL
    ) x
    WHERE x.rn = 20
)
WHERE o.group_key = 'YM-999999';
