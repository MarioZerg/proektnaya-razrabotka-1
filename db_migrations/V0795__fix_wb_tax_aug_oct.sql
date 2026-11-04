WITH months AS (
  SELECT d::date AS month FROM generate_series('2026-08-01'::date, '2026-10-01'::date, interval '1 month') d
), src AS (
  SELECT m.month,
         COALESCE(sum(p.orders_amount), 0) AS revenue,
         COALESCE(-sum(p.returns_amount), 0) AS returns
  FROM months m
  LEFT JOIN t_p86119184_proektnaya_razrabotk.marketplace_payouts p
    ON p.marketplace_code = 'wildberries'
   AND p.period_end >= m.month AND p.period_end < (m.month + interval '1 month')
  GROUP BY m.month
), calc AS (
  SELECT month, revenue, returns,
         round((revenue - returns) * 5 / 105, 2) AS vat,
         round(((revenue - returns) - (revenue - returns) * 5 / 105) * 6 / 100, 2) AS usn
  FROM src
)
UPDATE t_p86119184_proektnaya_razrabotk.tax_accruals a
SET revenue = calc.revenue, returns = calc.returns, vat = calc.vat, usn = calc.usn, total = calc.vat + calc.usn
FROM calc
WHERE a.month = calc.month AND a.marketplace_code = 'wildberries';