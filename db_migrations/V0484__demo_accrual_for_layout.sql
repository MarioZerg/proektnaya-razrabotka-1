-- Временная проверка вёрстки отчёта: одно начисление за прошедшую неделю.
--
-- Система считает с 24 августа, поэтому реальных строк ещё нет, а посмотреть,
-- как выглядит PDF, нужно сейчас. Строка помечена нулевой суммой возвратов и
-- будет заменена настоящим начислением при первом же запуске планировщика.
INSERT INTO manager_accruals (
    user_id, period_start, period_end, units, base_amount, percent,
    amount, per_unit, status, hold_until, returned_units, returned_amount
)
SELECT 32, DATE '2026-08-17', DATE '2026-08-23', 1953, 1433356.00, 3.5,
       50167.46, 25.6874, 'hold', DATE '2026-09-07', 0, 0
WHERE NOT EXISTS (
    SELECT 1 FROM manager_accruals
    WHERE user_id = 32 AND period_start = DATE '2026-08-17'
);
