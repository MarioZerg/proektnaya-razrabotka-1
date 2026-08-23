-- Построчные продажи с площадок: кто, что и когда реально выкупил.
--
-- До сих пор «Выкупы» показывали только цеховые заказы FBS — те, что мы шьём
-- и отправляем сами. Их за месяц около полутора тысяч. А по данным площадки
-- за тот же месяц выкуплено 6 769 вещей: 3 619 по FBS и ещё 3 150 по FBO —
-- со склада OZON, куда мы отвозим товар партиями.
--
-- FBO-продажи в заказы не попадают вовсе: площадка торгует сама и сообщает о
-- них только в финансовом отчёте. Поэтому половина выручки была не видна.
--
-- Здесь храним каждую продажу отдельной строкой — из отчёта площадки, а не из
-- нашего конвейера. Это и есть источник правды по деньгам.
CREATE TABLE IF NOT EXISTS marketplace_sales (
    id BIGSERIAL PRIMARY KEY,
    marketplace_code VARCHAR(30) NOT NULL,
    -- FBO — со склада площадки, FBS — со своего.
    scheme VARCHAR(10),
    -- Номер отправления: по нему продажу можно найти в кабинете.
    posting_number VARCHAR(60),
    -- Наш артикул и номер товара площадки.
    sku VARCHAR(80),
    offer_id VARCHAR(120),
    -- Название товара, как его видит покупатель.
    product_name TEXT,
    material VARCHAR(100),
    width INTEGER,
    height INTEGER,
    quantity INTEGER DEFAULT 1,
    -- ЦЕНА ПРОДАЖИ — сумма по чеку, начисленная за вещь.
    sale_price NUMERIC(12,2),
    -- Когда покупатель забрал товар.
    sold_at TIMESTAMP,
    -- Возврат: вещь приехала обратно, деньги вернулись покупателю.
    is_return BOOLEAN DEFAULT false,
    synced_at TIMESTAMP DEFAULT now(),
    -- Одна и та же операция не должна попасть дважды при повторной загрузке.
    CONSTRAINT marketplace_sales_uniq
        UNIQUE (marketplace_code, posting_number, sku, is_return)
);

CREATE INDEX IF NOT EXISTS idx_mp_sales_sold_at
    ON marketplace_sales (sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_sales_mp_scheme
    ON marketplace_sales (marketplace_code, scheme);
CREATE INDEX IF NOT EXISTS idx_mp_sales_size
    ON marketplace_sales (material, width, height);
