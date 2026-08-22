-- Проверка: закрытый отчёт не пересчитывается.
--
-- Сдвигаем дату старта и помечаем одну неделю как выплаченную, чтобы
-- убедиться: пересчёт её не трогает, даже если цены изменились.
-- Вернём всё сразу после проверки.
UPDATE manager_commission_settings SET accrue_from = DATE '2026-08-03';

UPDATE manager_accruals
SET status = 'confirmed', cancelled_at = NULL, cancel_reason = NULL,
    paid_at = now(), amount = 99999
WHERE user_id = 32 AND marketplace_code = 'ozon'
  AND period_start = DATE '2026-08-03';
