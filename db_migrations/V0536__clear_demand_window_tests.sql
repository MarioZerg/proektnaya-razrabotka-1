-- Проверочные прогоны новой логики спроса помечаем как тест: цены они не
-- двигали, и счётчик пути к цели должен остаться на нуле.
UPDATE price_robot_runs SET decision = 'test' WHERE decision <> 'test';