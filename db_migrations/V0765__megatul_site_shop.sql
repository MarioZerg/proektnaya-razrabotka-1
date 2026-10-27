INSERT INTO t_p86119184_proektnaya_razrabotk.shops (code, name, color, is_active, sort_order)
SELECT 'megatul_site', 'мегатюль.рф', 'teal', true, 3
WHERE NOT EXISTS (SELECT 1 FROM t_p86119184_proektnaya_razrabotk.shops WHERE code = 'megatul_site');

ALTER TABLE t_p86119184_proektnaya_razrabotk.orders
  ADD COLUMN IF NOT EXISTS site_order_id varchar(64),
  ADD COLUMN IF NOT EXISTS site_customer_name varchar(255),
  ADD COLUMN IF NOT EXISTS site_customer_phone varchar(64),
  ADD COLUMN IF NOT EXISTS delivery_tracking_number varchar(128),
  ADD COLUMN IF NOT EXISTS delivery_label_url text;

CREATE INDEX IF NOT EXISTS idx_orders_site_order_id ON t_p86119184_proektnaya_razrabotk.orders (site_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_tracking ON t_p86119184_proektnaya_razrabotk.orders (delivery_tracking_number);

INSERT INTO t_p86119184_proektnaya_razrabotk.marketplace_integrations (marketplace_code, is_enabled, credentials, shop_id)
SELECT 'internet_shop', false, '{"siteUrl":"https://xn--80aff0ab3b6do.xn--p1ai"}'::jsonb, s.id
FROM t_p86119184_proektnaya_razrabotk.shops s
WHERE s.code = 'megatul_site'
  AND NOT EXISTS (SELECT 1 FROM t_p86119184_proektnaya_razrabotk.marketplace_integrations mi
                  WHERE mi.shop_id = s.id AND mi.marketplace_code = 'internet_shop');