-- Транспортная накладная для сторонних перевозчиков (Газелька и др.).
--
-- Форма по Приложению № 4 к Правилам перевозок грузов автомобильным транспортом
-- (в ред. ПП РФ от 30.11.2021 № 2116). Менеджер заполняет карточку, система
-- формирует файл XLSX, кладовщик скачивает его и отгружает поставку.
--
-- Отдельная таблица от etrn_documents: ЭТрН — электронный документооборот через
-- оператора ЭДО, а это накладная, которую печатают и отдают водителю. Складывать
-- их в одну таблицу означало бы мешать два разных процесса.

CREATE TABLE IF NOT EXISTS t_p86119184_proektnaya_razrabotk.waybill_documents (
    id SERIAL PRIMARY KEY,
    supply_id INTEGER NOT NULL UNIQUE
        REFERENCES t_p86119184_proektnaya_razrabotk.marketplace_supplies(id),

    -- Шапка документа
    number VARCHAR(50),
    doc_date DATE,
    order_number VARCHAR(50),
    order_date DATE,
    copy_number INTEGER DEFAULT 1,

    -- 1. Грузоотправитель (мы)
    shipper_details TEXT,
    shipper_is_forwarder BOOLEAN NOT NULL DEFAULT false,

    -- 1а. Заказчик услуг по организации перевозки (при наличии)
    customer_details TEXT,
    customer_contract TEXT,

    -- 2. Грузополучатель
    consignee_details TEXT,
    delivery_address TEXT,

    -- 3. Груз
    cargo_name TEXT,
    cargo_places TEXT,
    cargo_weight TEXT,
    cargo_value TEXT,
    cargo_danger TEXT,

    -- 4. Сопроводительные документы
    accompanying_docs TEXT,

    -- 5. Особые условия перевозки
    special_route TEXT,
    special_readdress TEXT,
    special_requirements TEXT,
    special_temperature TEXT,

    -- 6. Перевозчик и водитель
    carrier_details TEXT,
    driver_details TEXT,

    -- 7. Транспортное средство
    vehicle_details TEXT,
    vehicle_number VARCHAR(50),
    vehicle_ownership INTEGER,
    vehicle_ownership_doc TEXT,
    vehicle_permit TEXT,

    -- 8. Приём груза
    loader_details TEXT,
    loading_point_owner TEXT,
    loading_address TEXT,
    planned_loading_at TIMESTAMP,
    actual_arrival_at TIMESTAMP,
    actual_departure_at TIMESTAMP,
    loading_weight TEXT,
    loading_places TEXT,
    packaging TEXT,
    carrier_remarks TEXT,
    loader_signature TEXT,
    driver_signature TEXT,

    -- 10. Выдача груза
    unloading_address TEXT,
    planned_unloading_at TIMESTAMP,
    cargo_condition TEXT,
    unload_places TEXT,
    unload_weight TEXT,

    -- 12. Стоимость перевозки
    transport_cost TEXT,
    transport_cost_vat TEXT,
    transport_cost_total TEXT,

    -- Готовый файл накладной: его скачивает кладовщик перед отгрузкой
    file_url TEXT,
    file_name VARCHAR(300),
    file_generated_at TIMESTAMP,

    -- Готовность: менеджер заполнил и подтвердил — кладовщик может отгружать
    is_ready BOOLEAN NOT NULL DEFAULT false,
    ready_at TIMESTAMP,
    ready_by INTEGER REFERENCES t_p86119184_proektnaya_razrabotk.users(id),
    ready_by_name VARCHAR(200),

    comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by INTEGER REFERENCES t_p86119184_proektnaya_razrabotk.users(id)
);

CREATE INDEX IF NOT EXISTS idx_waybill_supply
    ON t_p86119184_proektnaya_razrabotk.waybill_documents(supply_id);
CREATE INDEX IF NOT EXISTS idx_waybill_ready
    ON t_p86119184_proektnaya_razrabotk.waybill_documents(is_ready);
