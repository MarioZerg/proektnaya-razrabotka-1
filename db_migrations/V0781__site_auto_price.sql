ALTER TABLE t_p86119184_proektnaya_razrabotk.site_pricing_settings
  ADD COLUMN IF NOT EXISTS auto_price boolean NOT NULL DEFAULT false;

ALTER TABLE t_p86119184_proektnaya_razrabotk.marketplace_items
  ADD COLUMN IF NOT EXISTS site_price_manual boolean NOT NULL DEFAULT false;