-- Помечаем проверочную запись как отклонённую, чтобы она не мешалась в рабочих
-- списках и счётчиках. Удалять данные нельзя, поэтому просто выводим её из оборота.
UPDATE t_p86119184_proektnaya_razrabotk.marketplace_returns
SET status = 'rejected'
WHERE external_id = 'CHECK-PICKUP-1';

UPDATE t_p86119184_proektnaya_razrabotk.goods_warehouse
SET status = 'written_off'
WHERE id IN (
    SELECT goods_warehouse_id FROM t_p86119184_proektnaya_razrabotk.marketplace_returns
    WHERE external_id = 'CHECK-PICKUP-1' AND goods_warehouse_id IS NOT NULL
);
