ALTER TABLE shipments
    ADD COLUMN is_auto_order BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE auto_order_blocks (
    id SERIAL PRIMARY KEY,
    material_id INTEGER NOT NULL REFERENCES materials(id),
    workshop_id INTEGER NOT NULL REFERENCES workshops(id),
    shift_number INTEGER NULL,
    blocked_at TIMESTAMP NOT NULL DEFAULT now(),
    blocked_by INTEGER NULL REFERENCES users(id)
);

CREATE INDEX idx_auto_order_blocks_key ON auto_order_blocks(material_id, workshop_id, shift_number);