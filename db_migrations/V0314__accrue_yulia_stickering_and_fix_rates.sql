-- Начисление Юле (user_id = 20) за стикеровку заказа 77862, которое не прошло.
--
-- Юля — швея, упаковщицы на смене не было, она застикеровала заказ сама под своим
-- аккаунтом. Работа выполнена, заказ закрыт (packer_user_id = 20), но денег за
-- стикеровку не начислилось: расчёт брал ставку упаковщика из строки «без ткани и
-- ширины», а в цехе №1 значение вбито в старые строки по тканям — там стоял ноль.
--
-- Считаем по тарифу упаковщицы, как и положено при подмене: 300 см = 3 пог.м. x 4 руб. = 12 руб.
-- Тип начисления packer_stickering — тот же, что у штатной упаковщицы, так что заказ
-- защищён от повторной оплаты уникальным индексом (order_id + type).

INSERT INTO salary_accruals (user_id, type, amount, order_id, description)
VALUES (
  20,
  'packer_stickering',
  12.00,
  77862,
  'Стикеровка заказа #119959612-41 - 3.0 п.м. (стикеровал швея вместо упаковщицы)'
)
ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING;

-- Приводим ставки цеха №1 к рабочему виду: значение должно лежать в основной строке
-- (без ткани и ширины), иначе расчёт снова возьмёт ноль.
UPDATE salary_rates sr
SET rate = src.max_rate, updated_at = now()
FROM (
  SELECT workshop_id, MAX(rate) AS max_rate
  FROM salary_rates WHERE role = 'packer'
  GROUP BY workshop_id
) src
WHERE sr.role = 'packer' AND sr.material_id IS NULL AND sr.width IS NULL
  AND sr.workshop_id = src.workshop_id AND sr.rate < src.max_rate;

UPDATE salary_rates sr
SET rate = src.max_rate, updated_at = now()
FROM (
  SELECT workshop_id, MAX(rate) AS max_rate
  FROM salary_rates WHERE role = 'packer_repack'
  GROUP BY workshop_id
) src
WHERE sr.role = 'packer_repack' AND sr.material_id IS NULL AND sr.width IS NULL
  AND sr.workshop_id = src.workshop_id AND sr.rate < src.max_rate;
