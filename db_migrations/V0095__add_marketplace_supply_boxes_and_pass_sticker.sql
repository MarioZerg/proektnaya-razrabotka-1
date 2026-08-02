ALTER TABLE marketplace_supplies
    ADD COLUMN total_quantity_marketplace INTEGER NULL,
    ADD COLUMN pass_sticker_url TEXT NULL,
    ADD COLUMN pass_sticker_name VARCHAR(200) NULL;

CREATE TABLE marketplace_supply_boxes (
    id SERIAL PRIMARY KEY,
    supply_id INTEGER NOT NULL REFERENCES marketplace_supplies(id),
    box_number INTEGER NOT NULL,
    barcode VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_supply_boxes_supply ON marketplace_supply_boxes(supply_id);

ALTER TABLE marketplace_supply_items
    ADD COLUMN box_id INTEGER NULL REFERENCES marketplace_supply_boxes(id);