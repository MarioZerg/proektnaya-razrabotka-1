UPDATE t_p86119184_proektnaya_razrabotk.goods_warehouse
SET status = 'in_stock', reserved_order_id = NULL, matched_at = NULL
WHERE id IN (16767, 16768, 16798, 16776, 16735)
  AND reserved_order_id IN (112414, 112426, 113101, 113751, 113782)
  AND shipping_labeled_at IS NULL AND shipped_at IS NULL;

UPDATE t_p86119184_proektnaya_razrabotk.orders
SET fulfilled_from_stock_id = NULL
WHERE id IN (112414, 112426, 113101, 113751, 113782)
  AND fulfilled_from_stock_id IN (16767, 16768, 16798, 16776, 16735);

INSERT INTO t_p86119184_proektnaya_razrabotk.goods_warehouse
  (order_id, reserved_order_id, status, storage_barcode, receive_reason, shipping_labeled_at, matched_at)
SELECT o.id, o.id, 'awaiting_supply',
       'GW-' || lpad(nextval('t_p86119184_proektnaya_razrabotk.goods_warehouse_storage_seq')::text, 6, '0'),
       'fbs_ready', COALESCE(o.packed_at, now()), now()
FROM t_p86119184_proektnaya_razrabotk.orders o
WHERE o.id IN (112414, 112426, 113101, 113751, 113782)
  AND NOT EXISTS (SELECT 1 FROM t_p86119184_proektnaya_razrabotk.goods_warehouse g WHERE g.order_id = o.id);