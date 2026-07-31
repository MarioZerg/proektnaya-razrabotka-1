CREATE TABLE shipments (
    id SERIAL PRIMARY KEY,
    type VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Выполнена',
    supplier_id INTEGER NULL REFERENCES suppliers(id),
    workshop_id INTEGER NULL REFERENCES workshops(id),
    shift_number INTEGER NULL,
    comment TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    completed_at TIMESTAMP NULL
);

CREATE INDEX idx_shipments_type ON shipments(type);

CREATE TABLE shipment_items (
    id SERIAL PRIMARY KEY,
    shipment_id INTEGER NOT NULL REFERENCES shipments(id),
    material_id INTEGER NOT NULL REFERENCES materials(id),
    barcode VARCHAR(50) NULL,
    roll_id INTEGER NULL REFERENCES rolls(id),
    quantity NUMERIC(12,3) NULL
);

CREATE INDEX idx_shipment_items_shipment ON shipment_items(shipment_id);