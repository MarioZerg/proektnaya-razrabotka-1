-- Проверка комиссии Яндекса за вывод средств (1,6%).
--
-- Реальных отчётов Яндекса пока нет: его API отдаёт только отчёт по услугам,
-- а сумму перечисления там ещё предстоит подключить. Чтобы убедиться, что
-- комиссия вычитается правильно, заводим пробный отчёт с круглой суммой.
-- Уберём сразу после проверки.
INSERT INTO marketplace_payouts (
    marketplace_code, period_start, period_end,
    orders_amount, returns_amount, commission_amount,
    services_amount, delivery_amount,
    accrued_amount, transferred_amount, synced_at
) VALUES (
    'yandex_market', DATE '2026-08-10', DATE '2026-08-16',
    120000, 0, -18000, 0, -2000, 100000, 100000, now()
)
ON CONFLICT (marketplace_code, period_start, period_end) DO UPDATE
SET transferred_amount = EXCLUDED.transferred_amount;
