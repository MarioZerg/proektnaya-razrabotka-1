-- Остатки на складах площадки — чтобы разнести хранение по товарам.
--
-- Зачем. Хранение приходит от площадки ОДНОЙ суммой за месяц (34 151 ₽ за
-- июль). Понять, какие позиции его съедают, по ней нельзя: залежавшийся товар
-- и быстро уходящий стоят одинаково.
--
-- Площадка не отдаёт «сколько дней лежит эта штука», поэтому считаем сами:
-- дни запаса = остаток / средние продажи в день. Позиция с остатком 300 штук
-- при продаже 2 в день лежит 150 дней и тянет хранение, а такая же с продажей
-- 30 в день уходит за декаду. Общую сумму хранения раскладываем по товарам
-- пропорционально «штуко-дням» — так залежавшийся товар получает свою долю,
-- а быстрый не платит за чужой простой.
CREATE TABLE IF NOT EXISTS marketplace_stocks (
    id SERIAL PRIMARY KEY,
    marketplace_code VARCHAR(40) NOT NULL,
    sku VARCHAR(60) NOT NULL,
    offer_id VARCHAR(120),
    product_name TEXT,
    -- Наш товар, если удалось сопоставить по артикулу.
    marketplace_item_id INTEGER,
    -- Свободно к продаже и в резерве под заказы.
    free_amount INTEGER NOT NULL DEFAULT 0,
    reserved_amount INTEGER NOT NULL DEFAULT 0,
    -- Сколько складов держит эту позицию: по одной строке на склад площадка
    -- отдаёт отдельно, здесь уже свёрнуто.
    warehouses INTEGER NOT NULL DEFAULT 1,
    synced_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stocks_uniq
    ON marketplace_stocks (marketplace_code, sku);

CREATE INDEX IF NOT EXISTS idx_stocks_item
    ON marketplace_stocks (marketplace_item_id);

COMMENT ON TABLE marketplace_stocks IS
    'Остатки на складах площадки: база для разнесения хранения по товарам';
