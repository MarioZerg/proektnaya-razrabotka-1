-- Проверочный ручной подъём (пауза после ручного шага) помечаем как тест:
-- цены он не двигал, и в счёте пути к цели ему не место.
UPDATE price_robot_runs
SET decision = 'test'
WHERE decision = 'manual' AND reason LIKE '%проверка паузы%';