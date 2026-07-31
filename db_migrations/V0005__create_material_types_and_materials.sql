CREATE TABLE IF NOT EXISTS material_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) UNIQUE NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materials (
    id SERIAL PRIMARY KEY,
    type_id INTEGER NOT NULL REFERENCES material_types(id),
    name VARCHAR(200) NOT NULL,
    unit VARCHAR(20) NOT NULL DEFAULT 'шт',
    cost NUMERIC(10,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO material_types (name, sort_order) VALUES
    ('Тюль', 1),
    ('Аксессуары', 2),
    ('Упаковка', 3);

INSERT INTO materials (type_id, name, unit, cost, status, sort_order)
SELECT id, 'Бамбук', 'п.м.', 161, 'active', 1 FROM material_types WHERE name = 'Тюль';
INSERT INTO materials (type_id, name, unit, cost, status, sort_order)
SELECT id, 'Лён', 'п.м.', 86.25, 'active', 2 FROM material_types WHERE name = 'Тюль';
INSERT INTO materials (type_id, name, unit, cost, status, sort_order)
SELECT id, 'Шифон', 'п.м.', 107, 'active', 3 FROM material_types WHERE name = 'Тюль';
INSERT INTO materials (type_id, name, unit, cost, status, sort_order)
SELECT id, 'Сетка', 'п.м.', 93, 'active', 4 FROM material_types WHERE name = 'Тюль';
INSERT INTO materials (type_id, name, unit, cost, status, sort_order)
SELECT id, 'Вуаль', 'п.м.', 80, 'active', 5 FROM material_types WHERE name = 'Тюль';

INSERT INTO materials (type_id, name, unit, cost, status, sort_order)
SELECT id, 'Тесьма 6 см', 'п.м.', 6.2, 'active', 1 FROM material_types WHERE name = 'Аксессуары';

INSERT INTO materials (type_id, name, unit, cost, status, sort_order)
SELECT id, 'Пакет 25x30', 'шт', 5.77, 'active', 1 FROM material_types WHERE name = 'Упаковка';
INSERT INTO materials (type_id, name, unit, cost, status, sort_order)
SELECT id, 'Пакет 30x35', 'шт', 6.93, 'active', 2 FROM material_types WHERE name = 'Упаковка';
INSERT INTO materials (type_id, name, unit, cost, status, sort_order)
SELECT id, 'Пакет 35x40', 'шт', 8, 'active', 3 FROM material_types WHERE name = 'Упаковка';
INSERT INTO materials (type_id, name, unit, cost, status, sort_order)
SELECT id, 'Рекламный флаер', 'шт', 1.67, 'archive', 4 FROM material_types WHERE name = 'Упаковка';