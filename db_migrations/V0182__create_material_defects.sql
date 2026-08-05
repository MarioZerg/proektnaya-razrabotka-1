-- Учёт брака материалов на терминале.
--
-- Брак ведём только по ТКАНИ и ТЕСЬМЕ: пакеты и этикетки не считаем — их брак копеечный,
-- а время сотрудника на оформление дороже. Причины разные для ткани и тесьмы, поэтому
-- храним код причины, а не свободный текст: только так можно посчитать, какой дефект
-- повторяется чаще и к какому поставщику есть вопросы.
--
-- Каждая запись брака получает свой штрихкод: сотрудник печатает стикер 58×40, кладёт
-- бракованный кусок в контейнер, а кладовщик потом сканирует его при приёмке на склад.

CREATE TABLE IF NOT EXISTS material_defects (
    id SERIAL PRIMARY KEY,
    -- Штрихкод стикера брака вида DF-000001 — по нему кладовщик принимает брак на склад.
    barcode VARCHAR(30) UNIQUE NOT NULL,
    roll_id INTEGER NOT NULL REFERENCES rolls(id),
    material_id INTEGER NOT NULL REFERENCES materials(id),
    -- Кто нашёл брак и в какой смене — для статистики по сотрудникам.
    user_id INTEGER NOT NULL REFERENCES users(id),
    user_name VARCHAR(255),
    user_role VARCHAR(30),
    workshop_id INTEGER REFERENCES workshops(id),
    shift_number INTEGER,
    shift_session_id INTEGER,
    quantity NUMERIC(12,3) NOT NULL,
    -- Код причины: fabric_* для ткани, trim_* для тесьмы.
    reason_code VARCHAR(40) NOT NULL,
    reason_label VARCHAR(120) NOT NULL,
    comment TEXT,
    -- Документ списания в shipments — остаток рулона уменьшается там же, как и раньше.
    shipment_id INTEGER REFERENCES shipments(id),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    -- Приёмка брака кладовщиком: пока не отсканирован, брак числится «в контейнере».
    received_at TIMESTAMP,
    received_by INTEGER REFERENCES users(id),
    received_by_name VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS material_defects_user_idx ON material_defects (user_id, created_at);
CREATE INDEX IF NOT EXISTS material_defects_pending_idx ON material_defects (received_at)
    WHERE received_at IS NULL;

-- Счётчик для штрихкодов брака DF-000001, DF-000002, ...
CREATE SEQUENCE IF NOT EXISTS material_defect_barcode_seq START 1;
