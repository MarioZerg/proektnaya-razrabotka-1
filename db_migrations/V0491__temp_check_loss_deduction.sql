-- Проверка расчёта с исключением убыточных на закрытой неделе 17–23.08.
--
-- Смотрим, что начисление считается с базы за вычетом убыточных продаж
-- и что в отчёте видно обе цифры. Дату вернём сразу после проверки.
UPDATE manager_commission_settings SET accrue_from = DATE '2026-08-17';

UPDATE manager_accruals
SET status = 'confirmed', cancelled_at = NULL, cancel_reason = NULL
WHERE user_id = 32 AND period_start = DATE '2026-08-17';
