-- СКЛАД КУСКОВ НА ПЕРЕШИВ — отдельно от рулонов.
--
-- ЗАЧЕМ. Упаковщица, разбирая брак или возврат, «распускала» вещь в рулон:
-- метраж просто прибавлялся к остатку рулона. Кусок терял размеры и
-- переставал существовать как отдельная вещь — закройщик видел только
-- обезличенные метры и не мог найти конкретный отрез под конкретный заказ.
--
-- Куски на перешив живут по другим правилам, чем рулон:
--   * рулон — это метраж, из него режут что угодно;
--   * кусок — это готовый отрез с ФИКСИРОВАННЫМИ шириной и высотой, и он
--     подходит под заказ, только если не меньше нужного размера.
--
-- Поэтому им нужна своя таблица, а не строка в рулонах.
CREATE TABLE IF NOT EXISTS repair_fabric_pieces (
    id SERIAL PRIMARY KEY,

    -- Откуда взялся кусок: вещь со склада, которую распустили.
    goods_warehouse_id INTEGER NULL REFERENCES goods_warehouse(id),

    -- Материал куска. Держим И ссылку, И название: по ссылке фильтруем
    -- выборку под карточку товара (вуаль — только вуалевые), а название
    -- показываем в таблицах, чтобы не джойнить справочник ради одной строки.
    material_id INTEGER NULL REFERENCES materials(id),
    material VARCHAR(100) NOT NULL,

    -- РАЗМЕРЫ КУСКА В САНТИМЕТРАХ — главное, ради чего заведена таблица.
    -- По ним решается, подойдёт ли кусок под заказ.
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,

    -- Где лежит: перешив доступен всем сменам цеха, но кто отправил — помним.
    workshop_id INTEGER NULL REFERENCES workshops(id),
    shift_number INTEGER NULL,

    -- Кто и когда отправил в перешив.
    created_by INTEGER NULL REFERENCES users(id),
    created_by_name VARCHAR(200) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),

    -- Состояние: available — лежит в цехе, used — израсходован закройщиком,
    -- written_off — списан администратором (брак, потеря).
    status VARCHAR(20) NOT NULL DEFAULT 'available',

    -- Кому ушёл кусок: заказ, закройщик, время.
    used_order_id INTEGER NULL REFERENCES orders(id),
    used_by INTEGER NULL REFERENCES users(id),
    used_by_name VARCHAR(200) NULL,
    used_at TIMESTAMP NULL,

    comment TEXT NULL
);

-- Выборка «что лежит в цехе» — самый частый запрос (карточка заказа,
-- таблица остатков, таблица админа).
CREATE INDEX IF NOT EXISTS idx_repair_pieces_available
    ON repair_fabric_pieces (material_id, width, height)
    WHERE status = 'available';

CREATE INDEX IF NOT EXISTS idx_repair_pieces_status
    ON repair_fabric_pieces (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_repair_pieces_gw
    ON repair_fabric_pieces (goods_warehouse_id);

COMMENT ON TABLE repair_fabric_pieces IS
    'Куски ткани на перешив: отрезы с фиксированными размерами, лежащие в цехе. Отдельно от рулонов, потому что подбираются по размеру под конкретный заказ.';
