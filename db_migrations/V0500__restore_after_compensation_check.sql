-- Возвращаем настройки после проверки компенсаций.
--
-- Проверено: компенсация 45 000 ₽ вошла в базу (1 433 356 + 45 000), и
-- вознаграждение выросло с 50 167 ₽ до 51 742 ₽. Пробную сумму убираем —
-- реальных компенсаций за этот период не было.
UPDATE marketplace_payouts
SET compensation_amount = 0
WHERE marketplace_code = 'ozon' AND period_start = DATE '2026-08-17';

UPDATE manager_commission_settings SET accrue_from = DATE '2026-08-24';

UPDATE manager_accruals
SET status = 'cancelled',
    cancelled_at = now(),
    cancel_reason = 'Пробный расчёт при настройке. Эта неделя оплачивается вручную'
WHERE user_id = 32 AND period_start < DATE '2026-08-24';
