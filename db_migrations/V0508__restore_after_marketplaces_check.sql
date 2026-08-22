-- Возвращаем настройки после проверки всех площадок.
--
-- Проверено:
--   OZON  — 3 недели, база от 1,33 до 1,49 млн ₽, вознаграждение 46–52 тыс ₽;
--   WB    — 2 недели, база 437 и 299 тыс ₽, вознаграждение 15,3 и 10,5 тыс ₽;
--   Яндекс — со 100 000 ₽ удержано 1 600 ₽ комиссии за вывод (1,6%),
--            процент взят с 98 400 ₽.
--
-- Пробный отчёт Яндекса обнуляем: настоящие суммы перечисления его API пока
-- не отдаёт, там доступен только отчёт по услугам.
UPDATE marketplace_payouts
SET transferred_amount = 0, orders_amount = 0, commission_amount = 0,
    delivery_amount = 0, accrued_amount = 0
WHERE marketplace_code = 'yandex_market';

UPDATE manager_commission_settings SET accrue_from = DATE '2026-08-24';

UPDATE manager_accruals
SET status = 'cancelled',
    cancelled_at = now(),
    cancel_reason = 'Пробный расчёт при настройке. Эти недели оплачиваются вручную'
WHERE user_id = 32 AND period_start < DATE '2026-08-24';
