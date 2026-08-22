-- Проверка учёта компенсаций на закрытой неделе 17–23.08.
--
-- Реальных компенсаций за июнь–август не было, поэтому подставляем пробную
-- сумму и смотрим, что она попадает в базу и увеличивает вознаграждение.
-- Значение обнулим сразу после проверки.
UPDATE marketplace_payouts
SET compensation_amount = 45000
WHERE marketplace_code = 'ozon' AND period_start = DATE '2026-08-17';

UPDATE manager_commission_settings SET accrue_from = DATE '2026-08-17';

UPDATE manager_accruals
SET status = 'pending', cancelled_at = NULL, cancel_reason = NULL
WHERE user_id = 32 AND period_start = DATE '2026-08-17';
