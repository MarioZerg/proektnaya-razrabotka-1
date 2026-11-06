ALTER TABLE t_p86119184_proektnaya_razrabotk.orders ADD COLUMN IF NOT EXISTS delivery_barcode varchar(64);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_barcode ON t_p86119184_proektnaya_razrabotk.orders (delivery_barcode) WHERE delivery_barcode IS NOT NULL;
UPDATE t_p86119184_proektnaya_razrabotk.orders SET delivery_barcode = '402178012536000' WHERE id = 128356 AND marketplace = 'IM';