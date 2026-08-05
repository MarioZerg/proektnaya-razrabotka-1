-- Цех №1 работает по 2/2: смена №1 вышла 4 августа (работает 4-5, потом отдыхает 6-7),
-- смена №2 заступает 6 августа. Так две смены чередуются и не выходят в один день.
UPDATE shifts SET cycle_work_days = 2, cycle_off_days = 2, cycle_start_date = '2026-08-04'
WHERE workshop_id = 1 AND shift_number = 1;

UPDATE shifts SET cycle_work_days = 2, cycle_off_days = 2, cycle_start_date = '2026-08-06'
WHERE workshop_id = 1 AND shift_number = 2;
