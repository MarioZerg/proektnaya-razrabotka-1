-- Себестоимость материалов привязывается к ПОСТАВЩИКУ: один и тот же материал у разных
-- поставщиков стоит по-разному, часть цен в валюте, часть фиксированные в рублях.

-- 1) Валюта и курс поставщика. Курс — значение по умолчанию, при приёмке администратор
--    может его поправить под реальный курс дня.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'RUB';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(12,4);

COMMENT ON COLUMN suppliers.currency IS 'Валюта прайса поставщика: RUB, USD, EUR, CNY';
COMMENT ON COLUMN suppliers.exchange_rate IS 'Курс валюты к рублю по умолчанию (для RUB не нужен)';

-- 2) Прайс поставщика: цена конкретного материала у конкретного поставщика.
--    У тесьмы и части тканей цена фиксированная в рублях — тогда currency='RUB'.
CREATE TABLE IF NOT EXISTS supplier_prices (
    id SERIAL PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    material_id INTEGER NOT NULL REFERENCES materials(id),
    -- Цена за единицу материала (пог.м. или шт) в валюте поставщика.
    price NUMERIC(12,4) NOT NULL DEFAULT 0,
    -- Валюта именно этой позиции: у поставщика ткань может быть в долларах,
    -- а тесьма — в рублях по фиксированной цене.
    currency VARCHAR(10) NOT NULL DEFAULT 'RUB',
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_prices_unique
    ON supplier_prices (supplier_id, material_id);

-- 3) Себестоимость рулона — считается при подтверждении приёмки и хранится НАВСЕГДА.
--    Даже если цены поставщика потом изменятся, у принятого рулона останется своя.
ALTER TABLE rolls ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id);
ALTER TABLE rolls ADD COLUMN IF NOT EXISTS shipment_id INTEGER REFERENCES shipments(id);
-- Цена материала в валюте поставщика на момент приёмки.
ALTER TABLE rolls ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(12,4);
ALTER TABLE rolls ADD COLUMN IF NOT EXISTS purchase_currency VARCHAR(10);
ALTER TABLE rolls ADD COLUMN IF NOT EXISTS purchase_rate NUMERIC(12,4);
-- Логистика, приходящаяся на единицу этого рулона.
ALTER TABLE rolls ADD COLUMN IF NOT EXISTS logistics_per_unit NUMERIC(12,4) NOT NULL DEFAULT 0;
-- ИТОГОВАЯ себестоимость 1 пог.м. или 1 шт в рублях: цена*курс + логистика.
-- По ней считаются недостачи в деньгах.
ALTER TABLE rolls ADD COLUMN IF NOT EXISTS cost_per_unit NUMERIC(12,4);

COMMENT ON COLUMN rolls.cost_per_unit IS 'Себестоимость 1 единицы в рублях: цена*курс + логистика на единицу';

-- 4) Логистика поставки: администратор вводит сумму за день при подтверждении приёмки.
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS logistics_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(12,4);

COMMENT ON COLUMN shipments.logistics_cost IS 'Стоимость логистики поставки, делится поровну на все единицы';

-- 5) Цена и валюта позиции поставки — администратор указывает их при подтверждении.
ALTER TABLE shipment_items ADD COLUMN IF NOT EXISTS price NUMERIC(12,4);
ALTER TABLE shipment_items ADD COLUMN IF NOT EXISTS currency VARCHAR(10);

CREATE INDEX IF NOT EXISTS idx_rolls_supplier ON rolls (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_material ON supplier_prices (material_id);