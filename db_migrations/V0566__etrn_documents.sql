-- Электронная транспортная накладная (ЭТрН) по поставке FBO.
--
-- С 01.09 сортировочные центры принимают только электронные транспортные
-- документы: бумажные версии больше не принимаются, за нарушение порядка
-- оформления предусмотрена ответственность по ст. 11.14.3 КоАП РФ.
--
-- САМ ДОКУМЕНТ ПОДПИСЫВАЕТСЯ НЕ ЗДЕСЬ. По закону обмен ЭТрН идёт только через
-- аккредитованного оператора ИС ЭПД (у нас — Контур.Диадок). Эта таблица хранит
-- реквизиты перевозки, статус подписания и ссылку на подписанный файл, который
-- вернул оператор. Каркас намеренно не завязан на API Диадока: поля operator_*
-- заполнятся, когда интеграцию подключат, а пока их ведут вручную.
CREATE TABLE IF NOT EXISTS etrn_documents (
    id SERIAL PRIMARY KEY,
    supply_id INTEGER NOT NULL UNIQUE REFERENCES marketplace_supplies(id),

    -- Номер и дата накладной. Номер присваивает оператор; до отправки поле пустое.
    number VARCHAR(50),
    doc_date DATE,

    -- Статус в нашей системе. Подписывает руководитель (ИП), поэтому промежуточный
    -- статус «На подписи» — это ожидание его действия, а не техническая пауза.
    status VARCHAR(20) NOT NULL DEFAULT 'Черновик',

    -- Грузоотправитель — наши реквизиты на момент отгрузки. Сохраняем копией,
    -- а не ссылкой: реквизиты могут поменяться, а документ должен остаться прежним.
    shipper_name VARCHAR(300),
    shipper_inn VARCHAR(20),
    shipper_address TEXT,

    -- Перевозчик. Обычно Газелька, но возят и сторонние компании.
    carrier_name VARCHAR(300),
    carrier_inn VARCHAR(20),
    -- Водитель и машина: их вписывают в накладную, без них СЦ груз не примет.
    driver_name VARCHAR(200),
    driver_phone VARCHAR(30),
    vehicle_number VARCHAR(20),
    vehicle_model VARCHAR(100),

    -- Грузополучатель — сортировочный центр маркетплейса.
    consignee_name VARCHAR(300),
    consignee_address TEXT,

    -- Приём и сдача груза.
    pickup_address TEXT,
    pickup_at TIMESTAMP,
    delivery_at TIMESTAMP,

    -- Груз: места и вес. Заполняются из коробов поставки, но их можно поправить —
    -- фактический вес на весах отличается от расчётного.
    cargo_places INTEGER,
    cargo_weight_kg NUMERIC(10, 2),
    cargo_description TEXT,

    -- Данные оператора ЭДО. Пока интеграции нет, номер документа у оператора
    -- вносят вручную — по нему документ находят в Диадоке.
    operator_name VARCHAR(100) DEFAULT 'Контур.Диадок',
    operator_doc_id VARCHAR(100),

    -- Подписанный файл, полученный от оператора. Храним в S3, здесь только ссылка.
    signed_file_url TEXT,
    signed_file_name VARCHAR(300),
    signed_at TIMESTAMP,
    signed_by INTEGER REFERENCES users(id),
    signed_by_name VARCHAR(200),

    comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_etrn_supply ON etrn_documents(supply_id);
CREATE INDEX IF NOT EXISTS idx_etrn_status ON etrn_documents(status);

-- Реквизиты грузоотправителя по умолчанию: подставляются в новую накладную,
-- чтобы не вбивать их руками при каждой отгрузке.
INSERT INTO system_settings (key, value)
VALUES
    ('etrn_shipper_name', ''),
    ('etrn_shipper_inn', ''),
    ('etrn_shipper_address', ''),
    ('etrn_pickup_address', '')
ON CONFLICT (key) DO NOTHING;