-- Проверка расчёта без срока проверки.
--
-- Смотрим, что начисление за закрытую неделю сразу получает нужный статус:
-- «ожидает поступления», пока деньги на балансе площадки, и «к выплате»,
-- как только они пришли. Промежуточного холда быть не должно.
-- Дату вернём сразу после проверки.
UPDATE manager_commission_settings SET accrue_from = DATE '2026-08-17';

UPDATE manager_accruals
SET status = 'pending', cancelled_at = NULL, cancel_reason = NULL,
    paid_at = NULL, salary_accrual_id = NULL
WHERE user_id = 32 AND period_start = DATE '2026-08-17';
