-- Время, когда швея взяла заказ в работу (take_order) — нужно для лимита метража в смену
-- (seamstress_daily_limit) и таймаута между взятием заказов по ширине (timeout_200..800),
-- которые считаются за текущую открытую рабочую смену сотрудника.
ALTER TABLE orders ADD COLUMN taken_at TIMESTAMP NULL;
