-- Налог считается от суммы, начисленной продавцу площадкой: продажи минус
-- возвраты, комиссия, логистика и услуги. Раньше базой была полная выручка
-- продаж с баллами площадки — выходило вдвое больше.
ALTER TABLE t_p86119184_proektnaya_razrabotk.tax_accruals
  ADD COLUMN IF NOT EXISTS base NUMERIC(14, 2);

-- Комиссии Яндекс Маркета по доставленным заказам месяца.
ALTER TABLE t_p86119184_proektnaya_razrabotk.tax_revenue_monthly
  ADD COLUMN IF NOT EXISTS fees NUMERIC(14, 2) NOT NULL DEFAULT 0;

-- Июль–октябрь были начислены от полной выручки, списаний по ним нет.
-- Убираем — ночная загрузка (tax_sync) начислит их заново от новой базы.
DELETE FROM t_p86119184_proektnaya_razrabotk.tax_accruals WHERE base IS NULL;
