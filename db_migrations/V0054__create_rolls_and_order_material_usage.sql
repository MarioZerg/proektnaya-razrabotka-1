CREATE TABLE rolls (
    id SERIAL PRIMARY KEY,
    barcode VARCHAR(50) UNIQUE NOT NULL,
    material_id INTEGER NOT NULL REFERENCES materials(id),
    workshop_id INTEGER NULL REFERENCES workshops(id),
    shift_number INTEGER NULL,
    initial_quantity NUMERIC(12,3) NOT NULL,
    remaining_quantity NUMERIC(12,3) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'in_storage',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    completed_at TIMESTAMP NULL
);

CREATE INDEX idx_rolls_material ON rolls(material_id);
CREATE INDEX idx_rolls_status ON rolls(status);

CREATE TABLE order_material_usage (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    material_id INTEGER NOT NULL REFERENCES materials(id),
    roll_id INTEGER NULL REFERENCES rolls(id),
    quantity NUMERIC(12,3) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_omu_order ON order_material_usage(order_id);
CREATE INDEX idx_omu_roll ON order_material_usage(roll_id);