-- Налоги с маркетплейсов (УСН + НДС) для виджета «Налоги» в «Финансах».
--
-- Выручка Яндекс Маркета по месяцам: отчёта о реализации в базе не было,
-- считаем по доставленным заказам.
CREATE TABLE IF NOT EXISTS t_p86119184_proektnaya_razrabotk.tax_revenue_monthly (
    marketplace_code VARCHAR(32) NOT NULL,
    month DATE NOT NULL,
    -- Выручка по цене реализации (покупатель + доплаты площадки), без вычета возвратов.
    revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
    -- Возвраты той же ценой, положительным числом.
    returns NUMERIC(14, 2) NOT NULL DEFAULT 0,
    orders_count INTEGER NOT NULL DEFAULT 0,
    synced_at TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (marketplace_code, month)
);

-- Начисленный налог за закрытый месяц по площадке. Пишется один раз —
-- 1-го числа за прошлый месяц — и больше не меняется: баланс виджета
-- двигается раз в месяц, а не от каждой синхронизации.
CREATE TABLE IF NOT EXISTS t_p86119184_proektnaya_razrabotk.tax_accruals (
    month DATE NOT NULL,
    marketplace_code VARCHAR(32) NOT NULL,
    revenue NUMERIC(14, 2) NOT NULL,
    returns NUMERIC(14, 2) NOT NULL,
    vat NUMERIC(14, 2) NOT NULL,
    usn NUMERIC(14, 2) NOT NULL,
    total NUMERIC(14, 2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (month, marketplace_code)
);

-- Списания кнопкой «Списать»: налог уплачен.
CREATE TABLE IF NOT EXISTS t_p86119184_proektnaya_razrabotk.tax_writeoffs (
    id SERIAL PRIMARY KEY,
    amount NUMERIC(14, 2) NOT NULL,
    comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by INTEGER,
    created_by_name VARCHAR(200),
    deleted_at TIMESTAMP NULL
);
