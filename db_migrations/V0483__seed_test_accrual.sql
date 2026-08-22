-- Пробное начисление за прошедшую неделю — чтобы проверить, что PDF-отчёт
-- собирается и открывается. Данные настоящие: неделя 17–23 августа,
-- перечисление 1 433 356 ₽ по отчёту площадки.
--
-- Строка временная: при первом же автоматическом расчёте она будет заменена
-- реальными начислениями с 24 августа.
INSERT INTO manager_accruals (
    user_id, period_start, period_end, units, base_amount, percent,
    amount, per_unit, status, hold_until
)
SELECT 32, '2026-08-17', '2026-08-23', 1953, 1433356.00, 3.5,
       50167.46, 25.6874, 'hold', '2026-09-07'
WHERE NOT EXISTS (
    SELECT 1 FROM manager_accruals
    WHERE user_id = 32 AND period_start = '2026-08-17'
);
