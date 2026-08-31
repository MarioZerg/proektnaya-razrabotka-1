-- Доначисляем зарплату по заказу 55691968-0274-5 (id 91076).
--
-- ПОЧЕМУ ДЕНЬГИ ПОТЕРЯЛИСЬ.
-- Заказ закрывали на терминале 31 августа в 11:07. Закрытие идёт цепочкой:
-- списать упаковку → поставить статус «Готовые» → завести складскую запись →
-- начислить зарплату швее и упаковщице → записать в журнал.
--
-- Цепочка оборвалась на складской записи: её код (GW-…) считался как
-- «максимум плюс один», и при одновременной работе двух терминалов два запроса
-- получили один и тот же номер. Код обязан быть уникальным — второй запрос упал,
-- а вместе с ним не создались ни складская запись, ни начисления.
--
-- При этом упаковка уже списана, а статус «Готовые» проставлен: заказ выглядит
-- закрытым, но швея и упаковщица за него денег не получили. Соседние заказы той
-- же минуты (91070, 91075, 91086) прошли полностью и оплачены.
--
-- Причина устранена в V0552: номер выдаёт счётчик базы, столкнуться невозможно.
-- Здесь возвращаем деньги за уже потерянный заказ.
--
-- accrued_for = 31 августа — как у соседних заказов этой же смены, чтобы
-- начисления попали в тот же расчётный период, а не в сегодняшний.

-- Пошив: ставка за штуку по ширине 300 см в цехе №1 = 75.60
INSERT INTO salary_accruals (user_id, type, amount, order_id, description, accrued_for)
SELECT o.assigned_user_id, 'sewer_piece', sr.rate, o.id,
       'Пошив заказа #' || o.order_number || ' (' || o.width || ' см) (доначислено)',
       DATE '2026-08-31'
  FROM orders o
  JOIN salary_rates sr ON sr.role = 'sewer'
                      AND sr.width = o.width
                      AND sr.workshop_id = o.workshop_id
 WHERE o.id = 91076
   AND sr.rate > 0
   AND NOT EXISTS (SELECT 1 FROM salary_accruals a
                    WHERE a.order_id = o.id AND a.type = 'sewer_piece')
ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING;

-- Стикеровка: ставка за пог.метр из цеха САМОЙ упаковщицы, метраж = ширина / 100.
INSERT INTO salary_accruals (user_id, type, amount, order_id, description, accrued_for)
SELECT o.packer_user_id, 'packer_stickering',
       round((o.width::numeric / 100) * pr.rate, 2), o.id,
       'Стикеровка заказа #' || o.order_number || ' - ' ||
       round(o.width::numeric / 100, 2) || ' п.м. (доначислено)',
       DATE '2026-08-31'
  FROM orders o
  JOIN users pu ON pu.id = o.packer_user_id
  JOIN workshops pw ON pw.name = pu.workshop
  JOIN LATERAL (SELECT MAX(rate) AS rate FROM salary_rates
                 WHERE role = 'packer' AND workshop_id = pw.id) pr ON TRUE
 WHERE o.id = 91076
   AND pr.rate > 0
   AND NOT EXISTS (SELECT 1 FROM salary_accruals a
                    WHERE a.order_id = o.id AND a.type = 'packer_stickering')
ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING;
