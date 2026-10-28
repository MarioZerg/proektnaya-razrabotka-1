CREATE TABLE IF NOT EXISTS site_pricing_settings (
  id SERIAL PRIMARY KEY,
  target_profit_pct NUMERIC(6,2) NOT NULL DEFAULT 30,
  tax_pct NUMERIC(6,2) NOT NULL DEFAULT 6,
  acquiring_pct NUMERIC(6,2) NOT NULL DEFAULT 2,
  blogger_pct NUMERIC(6,2) NOT NULL DEFAULT 10,
  delivery_rub NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_by INTEGER NULL
);
INSERT INTO site_pricing_settings (target_profit_pct) SELECT 30 WHERE NOT EXISTS (SELECT 1 FROM site_pricing_settings);