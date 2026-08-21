-- ОПТИМИЗАЦИЯ: индексы для самых горячих запросов.
--
-- Причина расхода вычислительных ресурсов найдена по статистике обращений:
-- две таблицы читались ЦЕЛИКОМ миллионы раз, потому что не хватало индексов.
--
--   marketplace_supply_items — 7,4 млн полных проходов, по индексу лишь 52 раза.
--     Таблица участвует в подзапросе счётчика подбора: «не лежит ли вещь уже в
--     поставке». Счётчик висит в меню у кладовщика и обновляется каждые три
--     минуты — и каждый раз база перебирала все строки заново.
--
--   marketplace_item_materials — 9,3 млн полных проходов. По ней считается
--     расход материала на товар: запрос идёт при каждом раскрое и в расчёте
--     себестоимости.
--
-- Индексы не меняют логику: те же запросы, но база находит строки сразу,
-- вместо того чтобы просматривать таблицу от начала до конца.

-- 1. Связь вещи с поставкой — по ней идёт проверка в счётчике подбора.
CREATE INDEX IF NOT EXISTS idx_supply_items_goods
    ON marketplace_supply_items (goods_warehouse_id);

-- 2. Состав поставки — открытие карточки поставки и сборка коробов.
CREATE INDEX IF NOT EXISTS idx_supply_items_supply
    ON marketplace_supply_items (supply_id);

-- 3. Раскладка по коробам внутри поставки.
CREATE INDEX IF NOT EXISTS idx_supply_items_box
    ON marketplace_supply_items (box_id) WHERE box_id IS NOT NULL;

-- 4. Расход материала по товару: индекс есть только по товару, а запрос почти
-- всегда идёт парой «товар + материал».
CREATE INDEX IF NOT EXISTS idx_mim_item_material
    ON marketplace_item_materials (marketplace_item_id, material_id);

-- 5. Позиции поставок поставщиков — 28% обращений шли полным проходом.
CREATE INDEX IF NOT EXISTS idx_shipment_items_material
    ON shipment_items (material_id);
