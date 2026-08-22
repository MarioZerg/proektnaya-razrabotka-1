-- Проверка расчёта без вычета возвратов на закрытой неделе 17–23.08.
--
-- Убеждаемся, что к выплате идёт полная сумма процента от перечисленного,
-- без повторного удержания за возвраты. Дату вернём сразу после проверки.
UPDATE manager_commission_settings SET accrue_from = DATE '2026-08-17';

-- Снимаем пометку с пробного начисления, чтобы пересчёт создал его заново.
UPDATE manager_accruals
SET status = 'confirmed', cancelled_at = NULL, cancel_reason = NULL
WHERE user_id = 32 AND period_start = DATE '2026-08-17';
