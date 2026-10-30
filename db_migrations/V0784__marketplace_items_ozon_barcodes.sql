ALTER TABLE t_p86119184_proektnaya_razrabotk.marketplace_items
  ADD COLUMN IF NOT EXISTS ozon_barcodes text[],
  ADD COLUMN IF NOT EXISTS ozon_barcodes_at timestamp;