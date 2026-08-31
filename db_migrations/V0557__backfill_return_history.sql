-- Восстанавливаем историю возвратов из уже накопленных данных.
--
-- Возвраты копятся с середины августа, и начинать счётчики с нуля неправильно:
-- вещь, которую уже дважды возвращали, сегодня показала бы «возвратов: 0», и
-- кладовщик положил бы её на полку не глядя. Переносим то, что известно.
--
-- ЧТО БЕРЁМ. Строки marketplace_returns, которые кладовщик реально принял
-- (received_at заполнен) и привязал к конкретной вещи (goods_warehouse_id).
--
-- ОСТОРОЖНО С ПОДСЧЁТОМ. В marketplace_returns строка на КАЖДУЮ позицию
-- возврата, и несколько РАЗНЫХ вещей одного отправления цепляются к одной
-- записи склада: у GW-723265 так набралось 5 строк с одинаковым номером
-- отправления, хотя саму вещь столько раз не возвращали. Поэтому считаем
-- уникальные ОТПРАВЛЕНИЯ (posting_number), а не строки — один приезд коробки
-- по одному отправлению = один возврат вещи.
INSERT INTO goods_return_history (
    goods_warehouse_id, return_number, order_id, order_number, posting_number,
    marketplace, return_reason, outcome, marketplace_return_id,
    returned_at, received_by
)
SELECT s.goods_warehouse_id,
       row_number() OVER (PARTITION BY s.goods_warehouse_id ORDER BY s.received_at),
       s.order_id,
       o.order_number,
       s.posting_number,
       s.marketplace,
       s.return_reason,
       s.outcome,
       s.id,
       s.received_at,
       s.received_by
  FROM (
        -- По одной строке на «вещь + отправление»: берём самую раннюю приёмку.
        SELECT DISTINCT ON (r.goods_warehouse_id, COALESCE(r.posting_number, r.id::text))
               r.id, r.goods_warehouse_id, r.order_id, r.posting_number,
               r.marketplace, r.return_reason, r.outcome,
               r.received_at, r.received_by
          FROM marketplace_returns r
         WHERE r.goods_warehouse_id IS NOT NULL
           AND r.received_at IS NOT NULL
         ORDER BY r.goods_warehouse_id,
                  COALESCE(r.posting_number, r.id::text),
                  r.received_at
       ) s
  LEFT JOIN orders o ON o.id = s.order_id
 WHERE NOT EXISTS (SELECT 1 FROM goods_return_history h
                    WHERE h.goods_warehouse_id = s.goods_warehouse_id
                      AND h.marketplace_return_id = s.id);
