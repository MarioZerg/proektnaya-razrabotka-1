-- Доначисляем зарплату за работу, которая осталась без оплаты.
--
-- ПОЧЕМУ ДЕНЬГИ ПОТЕРЯЛИСЬ.
--
-- 1) РАСКРОЙ. Ставка закройщика ищется по цеху заказа. Но цех заказу
--    проставляется ПОЗЖЕ — на терминале упаковщицы при закрытии. В момент
--    раскроя цеха у заказа ещё нет, ставка находилась нулевая, и начисление
--    молча не создавалось. У пошива такая подстраховка (взять штатный цех
--    самого работника) стояла давно, у раскроя её просто забыли поставить.
--
-- 2) ПОШИВ. Начисление создавалось только когда упаковщица закрывает заказ на
--    терминале. Если админ переводил заказ в «Готовые» руками из карточки,
--    зарплата за пошив не начислялась вовсе.
--
-- Обе дыры закрыты в коде. Здесь возвращаем деньги за уже потерянные заказы.
-- accrued_for ставим по фактической дате работы, а не сегодняшней: иначе
-- начисление попало бы в чужой расчётный период.

-- Раскрой: ставка за пог.метр по ткани, метраж = ширина / 100.
INSERT INTO salary_accruals (user_id, type, amount, order_id, description, accrued_for)
SELECT o.cutter_user_id,
       'cutter_cut',
       round((o.width::numeric / 100) * sr.rate, 2),
       o.id,
       'Раскрой заказа #' || o.id || ' (' || o.material || ' ' || o.width ||
       ' см) - ' || round(o.width::numeric / 100, 2) || ' пог.м. (доначислено)',
       o.cut_at::date
  FROM orders o
  JOIN users u  ON u.id = o.cutter_user_id
  LEFT JOIN workshops w2 ON w2.name = u.workshop
  LEFT JOIN materials m  ON lower(trim(m.name)) = lower(trim(o.material))
  JOIN salary_rates sr ON sr.role = 'cutter'
                      AND sr.material_id = m.id
                      AND sr.width IS NULL
                      AND sr.workshop_id = COALESCE(o.workshop_id, w2.id)
 WHERE o.cut_at IS NOT NULL
   AND COALESCE(o.source, '') <> 'import'
   AND o.width IS NOT NULL
   AND sr.rate > 0
   AND NOT EXISTS (SELECT 1 FROM salary_accruals a
                    WHERE a.order_id = o.id AND a.type = 'cutter_cut')
ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING;

-- Пошив: фиксированная ставка за штуку по ширине товара.
INSERT INTO salary_accruals (user_id, type, amount, order_id, description, accrued_for)
SELECT o.assigned_user_id,
       'sewer_piece',
       sr.rate,
       o.id,
       'Пошив заказа #' || o.order_number || ' (' || o.width || ' см) (доначислено)',
       o.created_at::date
  FROM orders o
  JOIN users u ON u.id = o.assigned_user_id
  LEFT JOIN workshops w2 ON w2.name = u.workshop
  JOIN salary_rates sr ON sr.role = 'sewer'
                      AND sr.width = o.width
                      AND sr.workshop_id = COALESCE(o.workshop_id, w2.id)
 WHERE o.sewing_status = 'Готовые'
   AND sr.rate > 0
   AND NOT EXISTS (SELECT 1 FROM salary_accruals a
                    WHERE a.order_id = o.id AND a.type = 'sewer_piece')
ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING;