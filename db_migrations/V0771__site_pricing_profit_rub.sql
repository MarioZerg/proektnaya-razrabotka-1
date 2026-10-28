ALTER TABLE site_pricing_settings ADD COLUMN IF NOT EXISTS min_profit_rub NUMERIC(12,2) NOT NULL DEFAULT 250;
ALTER TABLE site_pricing_settings ADD COLUMN IF NOT EXISTS max_profit_rub NUMERIC(12,2) NOT NULL DEFAULT 450;
UPDATE site_pricing_settings SET delivery_rub = 0;