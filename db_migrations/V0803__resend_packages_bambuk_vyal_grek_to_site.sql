UPDATE t_p86119184_proektnaya_razrabotk.marketplace_items mi
SET pack_updated_at = now()
FROM t_p86119184_proektnaya_razrabotk.shops s
WHERE s.id = mi.shop_id AND s.code = 'megatul_site'
  AND mi.archived_at IS NULL
  AND lower(mi.sku) ~ '^(bambuk|vyal|grek)[0-9]+_[0-9]+$'
  AND mi.pack_length_mm > 0 AND mi.pack_width_mm > 0 AND mi.pack_height_mm > 0 AND mi.pack_weight_g > 0;