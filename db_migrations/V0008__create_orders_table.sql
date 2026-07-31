CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(100) UNIQUE NOT NULL,
    marketplace VARCHAR(20) NOT NULL,
    order_type VARCHAR(30) NOT NULL DEFAULT 'FBO',
    status VARCHAR(20) NOT NULL DEFAULT 'Новый',
    cluster VARCHAR(100),
    product VARCHAR(200) NOT NULL,
    quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
    source VARCHAR(20) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    completed_at TIMESTAMP
);

INSERT INTO orders (order_number, marketplace, order_type, status, cluster, product, quantity, source, created_at)
VALUES
    ('119956630-172', 'OZON', 'FBO', 'Новый', 'Краснодар', 'Вуаль 200x265', 1, 'api', now() - interval '2 days 7 hours'),
    ('119956630-173', 'OZON', 'FBO', 'Новый', 'Краснодар', 'Вуаль 200x265', 1, 'api', now() - interval '2 days 7 hours'),
    ('119956630-174', 'OZON', 'FBO', 'Новый', 'Краснодар', 'Вуаль 200x265', 1, 'api', now() - interval '2 days 7 hours'),
    ('119956630-175', 'OZON', 'FBO', 'Новый', 'Краснодар', 'Вуаль 300x255', 1, 'api', now() - interval '2 days 7 hours'),
    ('119956630-176', 'OZON', 'FBO', 'Новый', 'Краснодар', 'Вуаль 300x255', 1, 'api', now() - interval '2 days 7 hours'),
    ('119956630-177', 'OZON', 'FBO', 'Новый', 'Краснодар', 'Вуаль 300x255', 1, 'api', now() - interval '2 days 7 hours'),
    ('119956630-178', 'OZON', 'FBO', 'Новый', 'Краснодар', 'Вуаль 300x265', 1, 'api', now() - interval '2 days 7 hours'),
    ('119956630-179', 'OZON', 'FBO', 'Новый', 'Краснодар', 'Вуаль 300x265', 1, 'api', now() - interval '2 days 7 hours'),
    ('119956630-180', 'OZON', 'FBO', 'Новый', 'Краснодар', 'Вуаль 300x265', 1, 'api', now() - interval '2 days 7 hours');