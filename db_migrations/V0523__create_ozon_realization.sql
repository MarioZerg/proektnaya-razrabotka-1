-- Отчёт о реализации OZON: официальные цифры по каждому проданному товару.
--
-- До сих пор маржа считалась двумя способами, и оба приблизительные.
-- Юнит-экономика берёт цену карточки и типовые тарифы — выходит средняя
-- по ассортименту, где размер, проданный девяносто раз, весит столько же,
-- сколько ни разу не проданный. Финансовые операции дают движение денег,
-- но не разбиты по товарам.
--
-- Отчёт о реализации — то, что OZON присылает как документ: по каждой
-- позиции цена продажи, комиссия и сумма к перечислению. Это не наш расчёт,
-- а официальная бумага, по которой площадка платит.
CREATE TABLE IF NOT EXISTS ozon_realization (
    id BIGSERIAL PRIMARY KEY,
    -- Отчётный месяц: документ формируется помесячно.
    period_month DATE NOT NULL,
    -- Номер документа — для сверки с кабинетом.
    doc_number VARCHAR(40),
    row_number INTEGER,
    sku VARCHAR(80),
    offer_id VARCHAR(120),
    product_name TEXT,
    material VARCHAR(100),
    width INTEGER,
    height INTEGER,
    quantity INTEGER DEFAULT 1,
    -- Цена, по которой продавец отдаёт вещь площадке.
    seller_price NUMERIC(12,2),
    -- Сколько площадка начислила за вещь по факту продажи.
    price_per_instance NUMERIC(12,2),
    amount NUMERIC(14,2),
    -- Комиссия площадки: и в рублях, и долей от цены.
    commission NUMERIC(14,2),
    commission_ratio NUMERIC(8,4),
    -- Баллы и софинансирование: площадка доплачивает продавцу за скидки.
    bonus NUMERIC(14,2),
    bank_coinvestment NUMERIC(14,2),
    -- Возвраты по этой позиции — их OZON вычитает из выплаты.
    return_amount NUMERIC(14,2),
    -- Итог к перечислению за позицию.
    total NUMERIC(14,2),
    synced_at TIMESTAMP DEFAULT now(),
    CONSTRAINT ozon_realization_uniq UNIQUE (period_month, row_number)
);

CREATE INDEX IF NOT EXISTS idx_ozon_realization_month
    ON ozon_realization (period_month DESC);
CREATE INDEX IF NOT EXISTS idx_ozon_realization_size
    ON ozon_realization (material, width, height);
CREATE INDEX IF NOT EXISTS idx_ozon_realization_sku
    ON ozon_realization (sku);
