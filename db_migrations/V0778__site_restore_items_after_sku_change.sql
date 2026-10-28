UPDATE t_p86119184_proektnaya_razrabotk.marketplace_items n
SET sku = 'dup:' || n.sku, site_product_id = NULL, archived_at = now(), updated_at = now()
FROM t_p86119184_proektnaya_razrabotk.marketplace_items o
WHERE n.shop_id = 3 AND o.shop_id = 3
  AND n.archived_at IS NULL AND o.archived_at IS NOT NULL
  AND n.internal_sku IS NULL AND o.internal_sku = n.sku
  AND NOT EXISTS (SELECT 1 FROM t_p86119184_proektnaya_razrabotk.marketplace_item_materials m WHERE m.marketplace_item_id = n.id)
  AND NOT EXISTS (SELECT 1 FROM t_p86119184_proektnaya_razrabotk.orders r WHERE r.marketplace_item_id = n.id);

UPDATE t_p86119184_proektnaya_razrabotk.marketplace_items o
SET sku = o.internal_sku, archived_at = NULL, updated_at = now()
WHERE o.shop_id = 3 AND o.internal_sku IS NOT NULL AND o.archived_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM t_p86119184_proektnaya_razrabotk.marketplace_items x WHERE x.shop_id = 3 AND x.sku = o.internal_sku);