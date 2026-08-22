-- Все статьи удержаний площадки по месяцам.
--
-- Зачем. В юнит-экономике товара учтены только комиссия, логистика, эквайринг
-- и реклама. А площадка удерживает гораздо больше: досрочная выплата, платные
-- слоты приёмки, подписка Premium, страхование, обработка на складе, бейджи.
-- За июль это 620 000 ₽ — около 101 ₽ на каждую проданную вещь при марже
-- порядка 240 ₽. То есть почти половина прибыли уходила незаметно.
--
-- В юнитку товара это класть нельзя: расходы относятся к периоду и к магазину
-- целиком, а не к конкретной вещи. Подписка Premium не становится больше от
-- того, что мы продали ещё одну штору. Поэтому храним отдельно, по месяцам,
-- и показываем на своём экране.
CREATE TABLE IF NOT EXISTS marketplace_fees_monthly (
    id SERIAL PRIMARY KEY,
    marketplace_code VARCHAR(40) NOT NULL,
    -- Первое число месяца.
    month DATE NOT NULL,
    -- Название статьи ровно как его называет площадка: так цифру можно
    -- сверить с отчётом в кабинете, не гадая, что во что переименовали.
    fee_name VARCHAR(200) NOT NULL,
    -- Сколько удержано за месяц, положительным числом.
    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    -- Сколько раз статья встретилась: видно, разовый это платёж или поштучный.
    operations INTEGER NOT NULL DEFAULT 0,
    -- Группа для отчёта: storage, logistics, service, marketing, penalty, other.
    category VARCHAR(30) NOT NULL DEFAULT 'other',
    calculated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Одна статья в месяце — одна строка: повторный расчёт обновляет её.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fees_monthly_uniq
    ON marketplace_fees_monthly (marketplace_code, month, fee_name);

CREATE INDEX IF NOT EXISTS idx_fees_monthly_month
    ON marketplace_fees_monthly (marketplace_code, month DESC);

COMMENT ON TABLE marketplace_fees_monthly IS
    'Удержания площадки по статьям и месяцам: то, чего нет в юнитке товара';
