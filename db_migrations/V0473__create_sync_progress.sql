-- Накопитель для постраничного чтения финансовых операций OZON.
--
-- Зачем. У площадки за месяц около 29 000 операций — 29 страниц по 1000.
-- Прочитать их за один вызов функции нельзя: не хватит таймаута. А читая
-- только первые 5 страниц (как было), мы видели 17% данных и получали
-- 1234 проданных штуки вместо примерно 5000 — делитель расходов занижался
-- в четыре раза, и себестоимость выходила завышенной.
--
-- Поэтому читаем порциями за несколько вызовов, а промежуточный итог копим
-- здесь. Когда страницы закончились, итог переносится в marketplace_ad_spend
-- и marketplace_ad_monthly, а строка накопителя очищается.
CREATE TABLE IF NOT EXISTS marketplace_sync_progress (
    marketplace_code VARCHAR(40) PRIMARY KEY,
    -- На какой странице остановились в прошлый раз.
    next_page INTEGER NOT NULL DEFAULT 1,
    -- Сколько всего страниц отдала площадка: по нему понимаем, что дошли.
    total_pages INTEGER,
    -- Границы периода: если их сменили, накопленное сбрасывается.
    date_from DATE,
    date_to DATE,
    -- Накопленные суммы.
    ad_spend NUMERIC(14, 2) NOT NULL DEFAULT 0,
    revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
    units_fbo INTEGER NOT NULL DEFAULT 0,
    units_fbs INTEGER NOT NULL DEFAULT 0,
    -- Помесячная разбивка копится как JSON: {'2026-08-01': [расход, оборот, штуки]}.
    by_month JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

COMMENT ON TABLE marketplace_sync_progress IS
    'Промежуточный итог постраничного чтения операций площадки';
