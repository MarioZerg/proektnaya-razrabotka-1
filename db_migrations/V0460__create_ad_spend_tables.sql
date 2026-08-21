-- РЕКЛАМА: фактические расходы на продвижение с площадок.
--
-- Задача: в юнит-экономике процент на продвижение задавался руками (OZON 10%,
-- WB 0%), а по факту OZON съедает около 22% выручки, WB — 160 тыс. в месяц.
-- Маржа считалась завышенной. Теперь тянем факт из кабинетов площадок.
--
-- Разносим ПО ТОВАРАМ там, где площадка это позволяет:
--   · WB отдаёт расход по каждому nmID — точная привязка;
--   · OZON списывает «Оплату за клик» общими суммами без товаров — по нему
--     считаем один процент на всю площадку и применяем ко всем позициям.

-- 1. nmID — внутренний номер товара на Wildberries.
--
-- Реклама WB привязана именно к нему, а у нас хранился только баркод
-- (wb_sku = 2040036064926), с рекламой он не сходится. Забираем nmID из
-- карточек вместе с габаритами — там он приходит рядом с артикулом.
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS wb_nm_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_marketplace_items_wb_nm
    ON marketplace_items (wb_nm_id) WHERE wb_nm_id IS NOT NULL;

COMMENT ON COLUMN marketplace_items.wb_nm_id IS
    'Номер товара на WB (nmID) — по нему приходят расходы на рекламу';

-- 2. Расходы на рекламу по товару за период.
--
-- Храним и сумму расхода, и выручку того же товара: процент имеет смысл только
-- как отношение одного к другому. Считать его на лету при каждом открытии
-- экрана нельзя — это несколько тяжёлых запросов к площадке.
CREATE TABLE IF NOT EXISTS marketplace_ad_spend (
    id SERIAL PRIMARY KEY,
    marketplace_code VARCHAR(30) NOT NULL,
    -- NULL = расход на всю площадку целиком (случай OZON: он не говорит,
    -- за какой товар списал деньги).
    marketplace_item_id INTEGER REFERENCES marketplace_items(id),
    -- За сколько дней посчитано: 30 по умолчанию.
    period_days INTEGER NOT NULL DEFAULT 30,
    -- Сколько потрачено на рекламу за период, рублей.
    ad_spend NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- Выручка за тот же период — знаменатель для процента.
    revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- Доля рекламы в выручке, %. Это число и уходит в юнит-экономику.
    ad_percent NUMERIC(6,2),
    calculated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Одна актуальная запись на товар (и одна общая на площадку).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_spend_item
    ON marketplace_ad_spend (marketplace_code, marketplace_item_id)
    WHERE marketplace_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_spend_total
    ON marketplace_ad_spend (marketplace_code)
    WHERE marketplace_item_id IS NULL;

COMMENT ON TABLE marketplace_ad_spend IS
    'Фактические расходы на рекламу по товарам — основа процента продвижения';

-- 3. Откуда брать процент продвижения.
--
-- Ручное значение оставляем как запасной вариант: если по товару рекламы не
-- было или площадка ничего не отдала, расчёт не должен обнуляться молча.
ALTER TABLE marketplace_tariffs
    ADD COLUMN IF NOT EXISTS promo_from_fact BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE marketplace_tariffs
    ADD COLUMN IF NOT EXISTS promo_fact_percent NUMERIC(6,2);

ALTER TABLE marketplace_tariffs
    ADD COLUMN IF NOT EXISTS promo_synced_at TIMESTAMP;

COMMENT ON COLUMN marketplace_tariffs.promo_from_fact IS
    'Брать процент рекламы из факта площадки, а не из ручного promo_percent';
COMMENT ON COLUMN marketplace_tariffs.promo_fact_percent IS
    'Средний фактический процент рекламы по площадке за период';
