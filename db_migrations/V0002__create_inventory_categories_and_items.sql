CREATE TABLE IF NOT EXISTS inventory_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    tab VARCHAR(100) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES inventory_categories(id),
    name VARCHAR(200) NOT NULL,
    quantity VARCHAR(50) NOT NULL DEFAULT '0',
    rolls VARCHAR(50) NOT NULL DEFAULT '0',
    status VARCHAR(50) NOT NULL DEFAULT 'В наличии',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO inventory_categories (name, tab, sort_order) VALUES
    ('Материал', 'Ткани', 1),
    ('Аксессуары', 'Ткани', 2),
    ('Материалы', 'Упаковка', 1);

INSERT INTO inventory_items (category_id, name, quantity, rolls, status, sort_order)
SELECT id, 'Вуаль', '120 м', '4', 'В наличии', 1 FROM inventory_categories WHERE name = 'Материал' AND tab = 'Ткани';

INSERT INTO inventory_items (category_id, name, quantity, rolls, status, sort_order)
SELECT id, 'Лён', '85 м', '3', 'В наличии', 2 FROM inventory_categories WHERE name = 'Материал' AND tab = 'Ткани';

INSERT INTO inventory_items (category_id, name, quantity, rolls, status, sort_order)
SELECT id, 'Сетка', '40 м', '1', 'Заканчивается', 3 FROM inventory_categories WHERE name = 'Материал' AND tab = 'Ткани';