-- ОКНО АНАЛИЗА СПРОСА.
--
-- Раньше робот сравнивал ровно столько дней, сколько длится шаг: при шаге
-- в 2 дня — двое суток после против двух до. Слишком коротко: 12 августа
-- продали 82 штуки, 13-го — 141. Один слабый день давал минус 30% и откат
-- цены на ровном месте.
--
-- Теперь окно не короче трёх дней: случайный провал в нём тонет, а реальное
-- падение спроса всё равно видно.
ALTER TABLE price_robot_settings
    ADD COLUMN IF NOT EXISTS demand_window_days INTEGER NOT NULL DEFAULT 3;

COMMENT ON COLUMN price_robot_settings.demand_window_days IS
    'Сколько дней продаж сравнивать до и после шага. Меньше 3 - слишком шумно';

-- ПОДТВЕРЖДЕНИЕ ПАДЕНИЯ.
--
-- Одиночный сигнал больше не двигает цену: первое падение - это пауза без
-- подъёма, робот ждёт следующего замера. Повторилось - откатываем. Резкое
-- падение (вдвое глубже порога) откатываем сразу, ждать там нечего.
ALTER TABLE price_robot_settings
    ADD COLUMN IF NOT EXISTS require_second_signal BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN price_robot_settings.require_second_signal IS
    'Откатывать только после второго падения подряд. Резкое падение - сразу';

-- Окно не должно быть короче трёх дней даже при коротком шаге.
UPDATE price_robot_settings
SET demand_window_days = GREATEST(3, step_days);