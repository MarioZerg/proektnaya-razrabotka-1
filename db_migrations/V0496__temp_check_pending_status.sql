-- Проверка статуса ожидания на закрытой неделе 17–23.08.
--
-- Деньги за неё ещё на балансе площадки, значит начисление должно создаться
-- в статусе «ожидает поступления» и НЕ попасть в сумму к выплате.
-- Дату вернём сразу после проверки.
UPDATE manager_commission_settings SET accrue_from = DATE '2026-08-17';

UPDATE manager_accruals
SET status = 'pending', cancelled_at = NULL, cancel_reason = NULL
WHERE user_id = 32 AND period_start = DATE '2026-08-17';
