CREATE TABLE IF NOT EXISTS marketplace_items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    sku VARCHAR(100),
    material VARCHAR(100),
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_item_materials (
    id SERIAL PRIMARY KEY,
    marketplace_item_id INTEGER NOT NULL REFERENCES marketplace_items(id),
    workshop_id INTEGER REFERENCES workshops(id),
    material_id INTEGER REFERENCES materials(id),
    quantity NUMERIC(10,3) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);