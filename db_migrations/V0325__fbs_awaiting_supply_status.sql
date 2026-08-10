-- Статус «на поставку» для застикерованных FBS-заказов.
--
-- Вещь, сшитая в цехе и застикерованная упаковщицей, физически лежит в контейнере и
-- ждёт кладовщика. Но записи на складе у неё не было: склад заводился только для
-- отменённых и индивидуальных заказов. Из-за этого кладовщик сканировал ярлык в
-- поставку и получал «не найдено среди собранных с полок» — системе нечего было найти.
--
-- Заводим для таких вещей складскую запись в статусе 'awaiting_supply': она не лежит
-- на полке, а ждёт отгрузки на маркетплейс. По этому статусу считается счётчик
-- «готово к сборке» и из него кладовщик сканирует вещи в поставку.
COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.goods_warehouse.status IS
    'in_stock — на полке; awaiting_shelf — ждёт раскладки; picking — собран с полки и '
    'отстикерован; awaiting_supply — сшит в цехе и застикерован, ждёт поставки; '
    'reserved — в поставке; shipped — отгружен';

-- Заводим складские записи для уже застикерованных FBS-заказов, которых нет на складе.
-- Без этого кладовщик не сможет отсканировать в поставку то, что уже лежит в контейнере.
INSERT INTO t_p86119184_proektnaya_razrabotk.goods_warehouse
    (order_id, status, storage_barcode, receive_reason, shipping_labeled_at)
SELECT o.id,
       'awaiting_supply',
       'GW-' || lpad((
           COALESCE((SELECT max(NULLIF(regexp_replace(storage_barcode, '\D', '', 'g'), '')::bigint)
                     FROM t_p86119184_proektnaya_razrabotk.goods_warehouse), 0)
           + row_number() OVER (ORDER BY o.id)
       )::text, 6, '0'),
       'fbs_ready',
       now()
FROM t_p86119184_proektnaya_razrabotk.orders o
WHERE o.order_type = 'FBS'
  AND o.sewing_status = 'Готовые'
  AND COALESCE(o.status, '') <> 'Отменён'
  AND o.fulfilled_from_stock_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM t_p86119184_proektnaya_razrabotk.goods_warehouse gw
      WHERE gw.order_id = o.id
  );
