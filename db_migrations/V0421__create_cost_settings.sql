-- НАСТРОЙКИ РАСЧЁТА СЕБЕСТОИМОСТИ.
--
-- Себестоимость складывается из того, что уже есть в системе: расход материалов на
-- изделие (marketplace_item_materials), цены поставщиков (supplier_prices) и тарифы
-- работ (salary_rates). Эти данные живые и обновляются сами.
--
-- Не хватало двух вещей, которые нигде не хранились:
--   1) налоговая ставка — её задаёт владелец, система её знать не может;
--   2) прочие расходы на единицу — аренда, электричество, оклады администрации.
--      Их нельзя вывести из заказов: это общие траты, которые владелец сам решает,
--      как размазать на товар.
--
-- Храним одной строкой на всю компанию: производство одно, ставка одна.
CREATE TABLE IF NOT EXISTS cost_settings (
    id SERIAL PRIMARY KEY,
    -- Налог с продажи, % (УСН 6, УСН 15 и т.п.).
    tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    -- Комиссия маркетплейса, % — забирается с каждой продажи.
    marketplace_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    -- Прочие расходы на одну вещь, руб: аренда, свет, администрация.
    overhead_per_item NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- Какой цех берём за образец для тарифов: ставки закройщика и швеи в цехах
    -- различаются, и себестоимость надо считать по какому-то одному.
    workshop_id INTEGER REFERENCES workshops(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by INTEGER
);

-- Единственная строка настроек. Дальше она только правится.
INSERT INTO cost_settings (tax_percent, marketplace_percent, overhead_per_item, workshop_id)
SELECT 0, 0, 0, (SELECT id FROM workshops ORDER BY id LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM cost_settings);
