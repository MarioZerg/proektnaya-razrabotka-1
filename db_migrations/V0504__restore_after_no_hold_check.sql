-- Возвращаем настройки после проверки отказа от срока проверки.
--
-- Проверено: начисление за 17–23.08 создалось со статусом «ожидает
-- поступления», а когда деньги пришли — сразу перешло в «к выплате»,
-- минуя промежуточную проверку. Промежуточного статуса больше нет.
--
-- Возвращаем реальную сумму вывода: деньги за эту неделю площадка ещё
-- не перевела. Пробное начисление аннулируем — неделя оплачивается вручную.
UPDATE marketplace_payouts
SET withdrawn_amount = 0
WHERE marketplace_code = 'ozon' AND period_start = DATE '2026-08-17';

UPDATE manager_commission_settings SET accrue_from = DATE '2026-08-24';

UPDATE manager_accruals
SET status = 'cancelled',
    cancelled_at = now(),
    cancel_reason = 'Пробный расчёт при настройке. Эта неделя оплачивается вручную'
WHERE user_id = 32 AND period_start < DATE '2026-08-24';
