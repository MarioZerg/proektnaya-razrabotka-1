-- Дата, когда швея закончила вещь и отправила её на стикеровку.
--
-- Раньше такой даты не было вовсе: у заказа есть cut_at (раскрой) и completed_at
-- (закрытие отправления маркетплейсом), но момент работы ШВЕИ нигде не фиксировался.
-- Из-за этого швея не могла сверить свою выработку за смену или неделю — по каким
-- датам смотреть, было непонятно, а completed_at заполнен меньше чем у четверти
-- заказов и означает совсем другое событие.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sewn_at timestamp NULL;

-- Восстанавливаем историю по зарплатным начислениям: строка sewer_piece создаётся
-- ровно в момент отправки заказа на стикеровку, поэтому её created_at — это и есть
-- время окончания работы швеи. Иначе фильтр по датам был бы пустым для всех
-- заказов, сделанных до этой миграции.
UPDATE orders o
SET sewn_at = a.created_at
FROM salary_accruals a
WHERE a.order_id = o.id
  AND a.type = 'sewer_piece'
  AND o.sewn_at IS NULL;

-- Выборка «моя работа за период» идёт по сотруднику и дате.
CREATE INDEX IF NOT EXISTS idx_orders_sewn_at ON orders (sewer_user_id, sewn_at);
CREATE INDEX IF NOT EXISTS idx_orders_cut_at_cutter ON orders (cutter_user_id, cut_at);
