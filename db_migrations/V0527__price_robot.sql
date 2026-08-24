-- РОБОТ ПОДЪЁМА ЦЕН.
--
-- Задача: медленно поднимать цены по всему ассортименту, пока маржа FBS за
-- последние 30 дней не дойдёт до цели. Если продажи после шага просели —
-- откатывать цену назад тем же шагом и выжидать.
--
-- Резкий подъём выбрасывает товар из скидки площадки и из выдачи, поэтому
-- шаг мелкий, а между шагами обязательная пауза.

CREATE TABLE IF NOT EXISTS price_robot_settings (
    id SERIAL PRIMARY KEY,
    marketplace_code VARCHAR(32) NOT NULL DEFAULT 'ozon',

    -- Включён ли робот вообще.
    is_active BOOLEAN NOT NULL DEFAULT false,

    -- РЕЖИМ НАБЛЮДЕНИЯ: робот считает и пишет в журнал, что сделал бы, но цены
    -- на витрину НЕ отправляет. Так владелец сначала смотрит на решения робота
    -- несколько циклов и только потом доверяет ему витрину.
    dry_run BOOLEAN NOT NULL DEFAULT true,

    -- На сколько процентов двигаем цену за один шаг.
    step_percent NUMERIC(5,2) NOT NULL DEFAULT 0.5,
    -- Сколько дней ждём между шагами: нужно накопить продажи для сравнения.
    step_days INTEGER NOT NULL DEFAULT 2,
    -- Час запуска по Москве.
    run_hour INTEGER NOT NULL DEFAULT 3,

    -- ЦЕЛЬ: маржа FBS за последние 30 дней. Дошли — робот останавливается сам.
    target_margin NUMERIC(5,2) NOT NULL DEFAULT 10.0,

    -- Насколько должны упасть продажи, чтобы робот откатил цену назад, %.
    drop_percent NUMERIC(5,2) NOT NULL DEFAULT 30.0,

    -- Предохранитель: дальше этого от стартовой цены робот не уйдёт ни вверх,
    -- ни вниз. Защита от накопления мелких шагов в большую ошибку.
    max_total_percent NUMERIC(5,2) NOT NULL DEFAULT 20.0,

    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by INTEGER,
    UNIQUE (marketplace_code)
);

-- ЖУРНАЛ ШАГОВ: что робот сделал и почему.
--
-- Без журнала автоматика превращается в чёрный ящик: цены поехали, а почему —
-- неизвестно. Здесь видно каждый шаг, продажи до и после и принятое решение.
CREATE TABLE IF NOT EXISTS price_robot_runs (
    id SERIAL PRIMARY KEY,
    marketplace_code VARCHAR(32) NOT NULL DEFAULT 'ozon',
    ran_at TIMESTAMP NOT NULL DEFAULT now(),

    -- raise — подняли, rollback — откатили, hold — выждали,
    -- stop — цель достигнута, skip — рано, пауза не вышла.
    decision VARCHAR(16) NOT NULL,
    -- Причина словами: её читает владелец, а не программист.
    reason TEXT,

    -- На сколько сдвинули цены этим шагом, % (минус — откат).
    step_percent NUMERIC(5,2),
    -- Маржа FBS за 30 дней на момент решения.
    margin_fbs NUMERIC(6,2),

    -- Продажи для сравнения: за период после прошлого шага и до него.
    units_after INTEGER,
    units_before INTEGER,
    -- Насколько изменились продажи, % (минус — упали).
    units_change NUMERIC(6,2),

    -- Сколько карточек реально ушло на площадку.
    items_pushed INTEGER NOT NULL DEFAULT 0,
    items_failed INTEGER NOT NULL DEFAULT 0,
    -- Был ли это холостой прогон (режим наблюдения).
    dry_run BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_robot_runs_at
    ON price_robot_runs (marketplace_code, ran_at DESC);

-- Настройки по умолчанию для OZON: выключен и в режиме наблюдения.
INSERT INTO price_robot_settings (marketplace_code, is_active, dry_run)
VALUES ('ozon', false, true)
ON CONFLICT (marketplace_code) DO NOTHING;