WITH src AS (
  SELECT COALESCE(sum(orders_amount), 0) AS revenue, COALESCE(-sum(returns_amount), 0) AS returns
  FROM t_p86119184_proektnaya_razrabotk.marketplace_payouts
  WHERE marketplace_code = 'wildberries' AND period_end >= '2026-07-01' AND period_end < '2026-08-01'
), calc AS (
  SELECT revenue, returns,
         round((revenue - returns) * 5 / 105, 2) AS vat,
         round(((revenue - returns) - (revenue - returns) * 5 / 105) * 6 / 100, 2) AS usn
  FROM src
)
UPDATE t_p86119184_proektnaya_razrabotk.tax_accruals a
SET revenue = calc.revenue, returns = calc.returns, vat = calc.vat, usn = calc.usn, total = calc.vat + calc.usn
FROM calc
WHERE a.month = '2026-07-01' AND a.marketplace_code = 'wildberries' AND a.total = 0;