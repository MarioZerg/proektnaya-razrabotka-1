ALTER TABLE marketplace_supplies
    ADD COLUMN ozon_delivery_method VARCHAR(20) NULL,
    ADD COLUMN ozon_application_number VARCHAR(50) NULL,
    ADD COLUMN ozon_status VARCHAR(50) NULL,
    ADD COLUMN supply_date DATE NULL,
    ADD COLUMN timeslot VARCHAR(50) NULL,
    ADD COLUMN shipment_type VARCHAR(50) NULL,
    ADD COLUMN packaging_type VARCHAR(20) NULL,
    ADD COLUMN packaging_count INTEGER NULL,
    ADD COLUMN gazelka_pickup BOOLEAN NOT NULL DEFAULT false;