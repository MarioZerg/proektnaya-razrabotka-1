-- ВОЗВРАТ ПОТЕРЯННЫХ ЗАКАЗОВ WB В ОЧЕРЕДЬ НА ОТГРУЗКУ.
--
-- Кладовщик убирал заказы из поставки (вещь не влезала в короб) или удалял поставку
-- целиком. Связь заказа с поставкой при этом просто удалялась — и заказ пропадал изо
-- всех списков: счётчик кладовщика считает заказы в накопителе, а этот заказ уже не
-- лежал ни в одной поставке. Вещь оставалась застикерованной на складе, но в новой
-- поставке не показывалась.
--
-- Возвращаем такие заказы в накопительный буфер — очередь на отгрузку, откуда
-- кладовщик забирает их сканированием. Сама причина устранена в коде: теперь при
-- удалении из поставки заказ переставляется в накопитель, а не удаляется.
--
-- Берём только живые готовые заказы: отгруженные и отменённые в очередь не идут.
WITH acc AS (
    INSERT INTO t_p86119184_proektnaya_razrabotk.marketplace_supplies
        (marketplace, type, status, comment, is_accumulator)
    SELECT 'WB', 'FBS', 'Открытая',
           'Накопительная поставка: заказы добавляются при стикеровке', true
    WHERE NOT EXISTS (
        SELECT 1 FROM t_p86119184_proektnaya_razrabotk.marketplace_supplies
        WHERE marketplace = 'WB' AND type = 'FBS' AND is_accumulator = true
          AND status IN ('Открытая', 'На сборке')
    )
    RETURNING id
),
target AS (
    SELECT COALESCE(
        (SELECT id FROM acc),
        (SELECT id FROM t_p86119184_proektnaya_razrabotk.marketplace_supplies
         WHERE marketplace = 'WB' AND type = 'FBS' AND is_accumulator = true
           AND status IN ('Открытая', 'На сборке')
         ORDER BY id DESC LIMIT 1)
    ) AS id
)
INSERT INTO t_p86119184_proektnaya_razrabotk.wb_supply_orders (supply_id, order_id)
SELECT (SELECT id FROM target), o.id
FROM t_p86119184_proektnaya_razrabotk.orders o
WHERE o.marketplace = 'WB' AND o.order_type = 'FBS'
  AND o.sewing_status IN ('Готовые', 'Со склада')
  AND o.status NOT IN ('Отгружен', 'Отменён')
  AND NOT EXISTS (
      SELECT 1 FROM t_p86119184_proektnaya_razrabotk.wb_supply_orders w
      WHERE w.order_id = o.id
  );
