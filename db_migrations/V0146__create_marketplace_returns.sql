-- Возвраты, загруженные с маркетплейса по API. Хранит заявки на возврат: пока товар едет
-- обратно, он числится "в пути", а когда физически доехал — кладовщик принимает его на склад
-- и вещь появляется в goods_warehouse.
CREATE TABLE IF NOT EXISTS marketplace_returns (
    id SERIAL PRIMARY KEY,
    marketplace VARCHAR(20) NOT NULL,
    -- Идентификатор возврата на стороне маркетплейса: по нему не грузим одно и то же дважды.
    external_id VARCHAR(100) NOT NULL,
    -- Отправление/заказ, по которому оформлен возврат.
    posting_number VARCHAR(100),
    order_id INTEGER NULL REFERENCES orders(id),
    -- Что именно возвращают: артикул продавца и наш товар из справочника.
    offer_id VARCHAR(100),
    sku VARCHAR(100),
    product_name VARCHAR(300),
    marketplace_item_id INTEGER NULL REFERENCES marketplace_items(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    -- Статус возврата на маркетплейсе и причина, которую указал покупатель.
    mp_status VARCHAR(100),
    return_reason TEXT,
    -- Наш статус обработки: new — загружен, received — принят кладовщиком на склад,
    -- rejected — отклонён/не приехал.
    status VARCHAR(20) NOT NULL DEFAULT 'new',
    goods_warehouse_id INTEGER NULL REFERENCES goods_warehouse(id),
    received_at TIMESTAMP NULL,
    received_by INTEGER NULL REFERENCES users(id),
    mp_created_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_marketplace_returns_external
    ON marketplace_returns (marketplace, external_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_returns_status
    ON marketplace_returns (status);
CREATE INDEX IF NOT EXISTS idx_marketplace_returns_posting
    ON marketplace_returns (posting_number);
