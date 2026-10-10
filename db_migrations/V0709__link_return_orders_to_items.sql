UPDATE orders o
SET marketplace_item_id = r.marketplace_item_id
FROM marketplace_returns r
WHERE r.order_id = o.id
  AND o.source = 'return'
  AND o.marketplace_item_id IS NULL
  AND r.marketplace_item_id IS NOT NULL;