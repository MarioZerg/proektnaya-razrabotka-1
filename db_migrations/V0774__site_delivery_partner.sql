ALTER TABLE t_p86119184_proektnaya_razrabotk.orders
  ADD COLUMN IF NOT EXISTS site_goods_rub NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS site_delivery_rub NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS site_city VARCHAR(255),
  ADD COLUMN IF NOT EXISTS site_partner_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS site_partner_rub NUMERIC(12,2);
ALTER TABLE t_p86119184_proektnaya_razrabotk.site_pricing_settings
  ADD COLUMN IF NOT EXISTS ship_from_city VARCHAR(255) DEFAULT 'Ярославль',
  ADD COLUMN IF NOT EXISTS ship_from_address VARCHAR(500) DEFAULT 'Ярославль, ул. Елены Колесовой, 48';
UPDATE t_p86119184_proektnaya_razrabotk.site_pricing_settings
  SET ship_from_city = 'Ярославль', ship_from_address = 'Ярославль, ул. Елены Колесовой, 48';