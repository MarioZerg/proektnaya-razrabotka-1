ALTER TABLE t_p86119184_proektnaya_razrabotk.marketplace_items ADD COLUMN internal_sku varchar(100) NULL;

UPDATE t_p86119184_proektnaya_razrabotk.marketplace_items mi
SET internal_sku = p.prefix || (mi.width / 100)::text || '_' || mi.height::text
FROM (VALUES
  ('bambuk','bambuk'), ('vual','vyal'), ('len','len'), ('molniya','mol'), ('mramor','mramor'),
  ('setka','grek'), ('shifon','krep'), ('venzel','venzel'), ('vyshivka','vyshivka'),
  ('geometriya','geometriya'), ('zhakkard','zhakkard'), ('listya','listya')
) AS p(pid, prefix)
WHERE mi.shop_id = 3 AND mi.site_product_id = p.pid AND mi.width IS NOT NULL AND mi.height IS NOT NULL;

CREATE UNIQUE INDEX marketplace_items_internal_sku_uq ON t_p86119184_proektnaya_razrabotk.marketplace_items (internal_sku) WHERE internal_sku IS NOT NULL;