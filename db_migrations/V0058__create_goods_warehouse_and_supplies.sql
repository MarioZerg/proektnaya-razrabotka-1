CREATE TABLE shelves (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE goods_warehouse (
    id SERIAL PRIMARY KEY,
    order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id),
    shelf_id INTEGER NULL REFERENCES shelves(id),
    status VARCHAR(20) NOT NULL DEFAULT 'in_stock',
    received_at TIMESTAMP NOT NULL DEFAULT now(),
    shipped_at TIMESTAMP NULL
);

CREATE INDEX idx_goods_warehouse_status ON goods_warehouse(status);

CREATE TABLE marketplace_supplies (
    id SERIAL PRIMARY KEY,
    marketplace VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Выполнена',
    comment TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    shipped_at TIMESTAMP NULL
);

CREATE TABLE marketplace_supply_items (
    id SERIAL PRIMARY KEY,
    supply_id INTEGER NOT NULL REFERENCES marketplace_supplies(id),
    goods_warehouse_id INTEGER NOT NULL REFERENCES goods_warehouse(id)
);