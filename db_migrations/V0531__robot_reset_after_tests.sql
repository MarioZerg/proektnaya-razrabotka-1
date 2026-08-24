-- Пробные прогоны отладки помечаем как проверочные: они не должны считаться
-- шагами робота и сдвигать счётчик подъёма цен.
UPDATE price_robot_runs SET decision = 'test' WHERE decision IN ('raise', 'rollback', 'stop', 'skip', 'hold');

-- Возвращаем боевые настройки: цель +10%, шаг 0.5% раз в 2 дня в 3:00 МСК,
-- откат при падении спроса на 30%. Робот выключен и в режиме наблюдения —
-- включает владелец, когда посмотрит на его решения.
UPDATE price_robot_settings
SET is_active = false,
    dry_run = true,
    step_percent = 0.5,
    step_days = 2,
    run_hour = 3,
    target_total_percent = 10.0,
    drop_percent = 30.0,
    max_total_percent = 20.0
WHERE marketplace_code = 'ozon';