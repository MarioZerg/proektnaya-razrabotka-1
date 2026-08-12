-- Доначисление закройщикам за раскрой, который не оплатился.
--
-- Причина: система не платила за заказы, перенесённые из старой системы
-- (source = 'import'). Предполагалось, что их раскроили ещё до переезда и деньги
-- люди уже получили. На практике эти заказы доходят до цеха нераскроенными, и
-- закройщик делает по ним полноценную работу — а в балансе она не появлялась.
-- Код исправлен: происхождение заказа на оплату больше не влияет.
--
-- Ставка берётся на МОМЕНТ РАСКРОЯ, а не текущая: тарифы на Мрамор и Сетку в
-- Цехе №1 подняли с 10 до 15 ₽ 12.08.2026 в 18:23, и на работу, сделанную до
-- этого, новая ставка не распространяется.
--
-- Затрагивает 179 заказов (633 пог.м) четырёх закройщиков с 10.08.2026.
-- Ожидаемая сумма: 6945 ₽. Выплат по этим начислениям не было.
INSERT INTO salary_accruals (user_id, type, amount, order_id, description)
SELECT
    o.cutter_user_id,
    'cutter_cut',
    ROUND(
        (o.width / 100.0) * (
            CASE
                WHEN o.material IN ('Мрамор', 'Сетка')
                     AND o.workshop_id = 1
                     AND o.cut_at < '2026-08-12'
                THEN 10.00
                ELSE sr.rate
            END
        ),
        2
    ),
    o.id,
    'Раскрой заказа #' || o.id || ' (' || m.name || ' ' || o.width::int
        || ' см) - ' || ROUND(o.width / 100.0, 2) || ' пог.м.'
FROM orders o
JOIN materials m ON m.name = o.material
JOIN salary_rates sr
     ON sr.role = 'cutter'
    AND sr.material_id = m.id
    AND sr.width IS NULL
    AND sr.workshop_id = o.workshop_id
LEFT JOIN salary_accruals sc
     ON sc.order_id = o.id
    AND sc.type = 'cutter_cut'
WHERE o.cutter_user_id IS NOT NULL
  AND o.cut_at >= '2026-08-10'
  AND sc.id IS NULL
  AND sr.rate > 0
  AND o.width IS NOT NULL
  AND o.workshop_id IS NOT NULL
ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING;
