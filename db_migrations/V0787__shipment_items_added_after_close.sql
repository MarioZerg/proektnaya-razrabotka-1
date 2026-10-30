ALTER TABLE t_p86119184_proektnaya_razrabotk.shipment_items ADD COLUMN IF NOT EXISTS added_after_close_at TIMESTAMP NULL;
ALTER TABLE t_p86119184_proektnaya_razrabotk.shipment_items ADD COLUMN IF NOT EXISTS added_after_close_by VARCHAR(255) NULL;
UPDATE t_p86119184_proektnaya_razrabotk.shipment_items si
SET added_after_close_at = a.created_at, added_after_close_by = a.user_name
FROM t_p86119184_proektnaya_razrabotk.audit_log a
WHERE a.action = 'add_roll_to_closed'
  AND a.entity_id = si.shipment_id
  AND a.description LIKE 'Довнёс рулон ' || si.barcode || ' %';