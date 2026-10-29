INSERT INTO t_p86119184_proektnaya_razrabotk.marketplace_item_materials (marketplace_item_id, workshop_id, material_id, quantity)
SELECT s.id, m.workshop_id, m.material_id, m.quantity
FROM t_p86119184_proektnaya_razrabotk.marketplace_items s
JOIN t_p86119184_proektnaya_razrabotk.marketplace_items mp
  ON mp.shop_id = 1 AND mp.archived_at IS NULL AND mp.sku = s.sku
JOIN t_p86119184_proektnaya_razrabotk.marketplace_item_materials m ON m.marketplace_item_id = mp.id
WHERE s.shop_id = 3 AND s.archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM t_p86119184_proektnaya_razrabotk.marketplace_item_materials z WHERE z.marketplace_item_id = s.id)
ORDER BY s.id, m.id;