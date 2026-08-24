-- Пробный ручной сдвиг при проверке помечаем как проверочный: он не должен
-- считаться настоящим шагом и сдвигать счётчик пути к цели.
UPDATE price_robot_runs SET decision = 'test' WHERE decision = 'manual';