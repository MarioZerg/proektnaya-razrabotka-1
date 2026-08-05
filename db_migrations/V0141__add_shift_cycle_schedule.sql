-- Цикличный график смен (2/2, 3/3 и т.п.): вместо ручной отметки каждого выходного
-- админ задаёт цикл и дату старта, а система сама раскладывает рабочие и выходные дни.
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS cycle_work_days INTEGER;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS cycle_off_days INTEGER;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS cycle_start_date DATE;
