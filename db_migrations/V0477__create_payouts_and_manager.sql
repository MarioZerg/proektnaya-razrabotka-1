-- Отчёты о выплатах площадок и вознаграждение менеджера.
--
-- Зачем. Менеджер маркетплейсов получает 3,5% с поступлений по отчётам.
-- Считалось это вручную: она сама сводила отчёты и называла сумму. Проверить
-- цифру было нечем, а в себестоимость товара её вознаграждение не попадало
-- вовсе — при том что это заметный расход на каждую проданную вещь.
--
-- ВАЖНО про базу расчёта. В отчёте есть две суммы: начислено (заказы минус
-- комиссия, услуги, логистика, возвраты) и фактически пришло на счёт. Они
-- расходятся, когда мы берём досрочную выплату: площадка удерживает её из
-- перевода. На пример 03.08–09.08: начислено 1 704 341 ₽, пришло 1 490 035 ₽,
-- удержано 214 306 ₽.
--
-- Процент менеджера считаем от НАЧИСЛЕННОГО: досрочная выплата — это наше
-- решение по деньгам, а не результат её работы, и урезать из-за неё
-- вознаграждение неправильно.
CREATE TABLE IF NOT EXISTS marketplace_payouts (
    id SERIAL PRIMARY KEY,
    marketplace_code VARCHAR(40) NOT NULL,
    -- Границы отчётного периода: у OZON это недели.
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    -- Продажи за период и что из них удержала площадка.
    orders_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    returns_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    commission_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    services_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    delivery_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    -- Начислено к выплате: с этой суммы считается процент менеджера.
    accrued_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    -- Фактически пришло на счёт. Отличается от начисленного, если брали
    -- досрочную выплату.
    paid_amount NUMERIC(14, 2),
    -- Сколько удержано досрочными выплатами: начислено минус пришло.
    early_payout_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    synced_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_uniq
    ON marketplace_payouts (marketplace_code, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_payouts_period
    ON marketplace_payouts (period_start DESC);

-- Ставка менеджера. Отдельной таблицей, чтобы её можно было менять из
-- интерфейса и чтобы старые расчёты не переписывались задним числом.
CREATE TABLE IF NOT EXISTS manager_commission_settings (
    id SERIAL PRIMARY KEY,
    -- Процент с поступлений.
    percent NUMERIC(6, 3) NOT NULL DEFAULT 3.5,
    -- С каких площадок считаем: пустой список — со всех.
    marketplaces TEXT,
    -- Включать ли вознаграждение в себестоимость товара.
    is_active BOOLEAN NOT NULL DEFAULT true,
    comment TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by INTEGER
);

INSERT INTO manager_commission_settings (percent, marketplaces, comment)
SELECT 3.5, '', 'Менеджер маркетплейсов: 3,5% с начисленного по отчётам'
WHERE NOT EXISTS (SELECT 1 FROM manager_commission_settings);

COMMENT ON TABLE marketplace_payouts IS
    'Отчёты площадок о выплатах: база для расчёта вознаграждения менеджера';
COMMENT ON COLUMN marketplace_payouts.accrued_amount IS
    'Начислено к выплате — база процента менеджера, досрочные не вычитаются';
