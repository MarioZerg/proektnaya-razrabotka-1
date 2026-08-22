-- Возвращаем дату автоматического расчёта после проверки.
--
-- Проверено: база уменьшается на долю убыточных продаж, и процент считается
-- уже с остатка. Сейчас убыточных нет — все цены выше точки безубыточности,
-- поэтому вычет нулевой, но механизм рабочий.
UPDATE manager_commission_settings SET accrue_from = DATE '2026-08-24';

UPDATE manager_accruals
SET status = 'cancelled',
    cancelled_at = now(),
    cancel_reason = 'Пробный расчёт при настройке. Эта неделя оплачивается вручную'
WHERE user_id = 32 AND period_start < DATE '2026-08-24';
