CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO suppliers (name, phone, address, comment) VALUES
    ('LIS ROWI', '+79663133825', 'Москва', 'Назира'),
    ('WB', '+7000000001', 'WildBerries', NULL),
    ('Ozon', '+7000000000', 'Ozon', NULL);