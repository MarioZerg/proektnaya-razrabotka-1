CREATE TABLE IF NOT EXISTS material_movements (
    id SERIAL PRIMARY KEY,
    material_id INTEGER NOT NULL REFERENCES materials(id),
    quantity NUMERIC(12,3) NOT NULL,
    movement_type VARCHAR(30) NOT NULL,
    reference VARCHAR(200),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_movements_material_id ON material_movements(material_id);