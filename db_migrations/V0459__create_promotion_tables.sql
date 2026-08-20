-- ПРОДВИЖЕНИЕ: история цен и СПП, рекомендации по цене, акции площадок.
--
-- Задача: держать маржу в коридоре 10-15%, поднимая цену мелкими шагами и не
-- теряя скидку площадки (СПП). Без истории это невозможно: чтобы понять, упал
-- СПП из-за нашего подъёма цены или площадка сама передумала, нужно видеть, что
-- было до шага и что стало после.

-- 1. СНИМКИ ЦЕН И СПП.
--
-- Пишем каждые 6 часов вместе с загрузкой цен. Один снимок на товар в сутки —
-- чаще не нужно, а таблица не растёт бесконтрольно.
CREATE TABLE IF NOT EXISTS price_history (
    id SERIAL PRIMARY KEY,
    marketplace_item_id INTEGER NOT NULL REFERENCES marketplace_items(id),
    marketplace_code VARCHAR(30) NOT NULL,
    -- Наша цена в кабинете.
    price NUMERIC(12,2),
    -- Цена, которую реально платит покупатель после скидки площадки.
    buyer_price NUMERIC(12,2),
    -- СПП: на сколько процентов площадка срезала нашу цену за свой счёт.
    spp_percent NUMERIC(6,2),
    -- Маржа на момент снимка — видно, к чему привёл прошлый шаг.
    margin_percent NUMERIC(6,2),
    captured_at TIMESTAMP NOT NULL DEFAULT now(),
    captured_on DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_history_daily
    ON price_history (marketplace_item_id, marketplace_code, captured_on);
CREATE INDEX IF NOT EXISTS idx_price_history_at
    ON price_history (marketplace_code, captured_at DESC);

COMMENT ON TABLE price_history IS
    'Снимки цены, СПП и маржи по товару — основа для решений о подъёме цены';

-- 2. РЕКОМЕНДАЦИИ ПО ЦЕНЕ.
--
-- Система не меняет цены сама: она предлагает шаг, а владелец решает. Каждое
-- предложение хранится с обоснованием — почему именно столько, и что было до.
CREATE TABLE IF NOT EXISTS price_recommendations (
    id SERIAL PRIMARY KEY,
    marketplace_item_id INTEGER NOT NULL REFERENCES marketplace_items(id),
    marketplace_code VARCHAR(30) NOT NULL,
    -- Что предлагаем: raise (поднять), lower (опустить), hold (не трогать).
    action VARCHAR(20) NOT NULL,
    current_price NUMERIC(12,2),
    suggested_price NUMERIC(12,2),
    current_margin NUMERIC(6,2),
    expected_margin NUMERIC(6,2),
    -- Человеческое объяснение: «маржа 6%, ниже цели — поднимаем на 2%».
    reason TEXT,
    -- Статус: new (ждёт решения), applied (применили), skipped (отклонили),
    -- rolled_back (откатили, СПП упал).
    status VARCHAR(20) NOT NULL DEFAULT 'new',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    decided_at TIMESTAMP,
    decided_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_price_rec_status
    ON price_recommendations (status, marketplace_code);
CREATE INDEX IF NOT EXISTS idx_price_rec_item
    ON price_recommendations (marketplace_item_id, created_at DESC);

COMMENT ON TABLE price_recommendations IS
    'Предложения по изменению цены — применяет владелец, система только считает';

-- 3. АКЦИИ ПЛОЩАДОК.
--
-- Площадка зовёт в акцию и обещает продвижение, но требует срезать цену. Здесь
-- считаем, что останется от маржи, и показываем прямо: идти или нет.
CREATE TABLE IF NOT EXISTS marketplace_promotions (
    id SERIAL PRIMARY KEY,
    marketplace_code VARCHAR(30) NOT NULL,
    -- Номер акции на площадке.
    external_id VARCHAR(100),
    title TEXT,
    date_start DATE,
    date_end DATE,
    -- Сколько наших товаров площадка зовёт в эту акцию.
    items_count INTEGER DEFAULT 0,
    -- Средняя маржа наших товаров, если пойти в акцию по её ценам.
    avg_margin NUMERIC(6,2),
    -- Сколько позиций уйдёт в минус.
    lossmaking_count INTEGER DEFAULT 0,
    -- Вердикт: good (идём), risky (осторожно), bad (в убыток).
    verdict VARCHAR(20),
    synced_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (marketplace_code, external_id)
);

CREATE INDEX IF NOT EXISTS idx_promotions_dates
    ON marketplace_promotions (marketplace_code, date_end DESC);

COMMENT ON TABLE marketplace_promotions IS
    'Акции площадок с расчётом: что останется от маржи, если участвовать';

-- 4. НАСТРОЙКИ СТРАТЕГИИ.
--
-- Коридор маржи и шаг подъёма задаёт владелец: у разных товаров разная
-- терпимость к риску, и зашивать числа в код нельзя.
CREATE TABLE IF NOT EXISTS pricing_strategy (
    id SERIAL PRIMARY KEY,
    -- Целевой коридор маржи, %.
    target_margin_min NUMERIC(6,2) NOT NULL DEFAULT 10,
    target_margin_max NUMERIC(6,2) NOT NULL DEFAULT 15,
    -- Шаг изменения цены за раз, % — мелкими шагами, чтобы не сбить СПП.
    step_percent NUMERIC(6,2) NOT NULL DEFAULT 2,
    -- Как часто можно двигать цену одного товара, дней.
    step_days INTEGER NOT NULL DEFAULT 7,
    -- Ниже какого СПП считаем, что скидка площадки потеряна, и откатываемся.
    min_spp_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by INTEGER REFERENCES users(id)
);

INSERT INTO pricing_strategy (target_margin_min, target_margin_max, step_percent, step_days)
SELECT 10, 15, 2, 7
WHERE NOT EXISTS (SELECT 1 FROM pricing_strategy);

COMMENT ON TABLE pricing_strategy IS
    'Правила ценообразования: целевой коридор маржи и безопасный шаг подъёма';
