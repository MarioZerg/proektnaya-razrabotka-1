ALTER TABLE t_p86119184_proektnaya_razrabotk.cost_extra_expenses
  ADD COLUMN IF NOT EXISTS channel varchar(20) NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS is_monthly boolean NOT NULL DEFAULT true;

UPDATE t_p86119184_proektnaya_razrabotk.cost_extra_expenses SET is_monthly = (per_items > 100);
UPDATE t_p86119184_proektnaya_razrabotk.cost_extra_expenses SET channel = 'marketplaces' WHERE name ILIKE '%ozon%' OR name ILIKE '%озон%' OR name ILIKE '%пвз%';
UPDATE t_p86119184_proektnaya_razrabotk.cost_extra_expenses SET is_monthly = false WHERE name ILIKE 'Коробки%';

ALTER TABLE t_p86119184_proektnaya_razrabotk.site_pricing_settings
  ADD COLUMN IF NOT EXISTS fixed_mode varchar(20) NOT NULL DEFAULT 'shared',
  ADD COLUMN IF NOT EXISTS site_monthly_units integer NOT NULL DEFAULT 300;