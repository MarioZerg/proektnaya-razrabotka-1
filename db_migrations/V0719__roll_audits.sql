-- Сверка склада материалов: кладовщик сканирует стикеры рулонов на складе,
-- система сравнивает с тем, что числится. Сверка ничего не меняет в рулонах.
CREATE TABLE IF NOT EXISTS roll_audits (
    id SERIAL PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    started_by INTEGER NULL,
    started_by_name VARCHAR(200) NULL,
    started_at TIMESTAMP NOT NULL DEFAULT now(),
    finished_at TIMESTAMP NULL,
    finished_by_name VARCHAR(200) NULL,
    expected_count INTEGER NOT NULL DEFAULT 0,
    found_count INTEGER NOT NULL DEFAULT 0,
    missing_count INTEGER NOT NULL DEFAULT 0,
    extra_count INTEGER NOT NULL DEFAULT 0,
    missing_snapshot TEXT NULL
);

CREATE TABLE IF NOT EXISTS roll_audit_scans (
    id SERIAL PRIMARY KEY,
    audit_id INTEGER NOT NULL REFERENCES roll_audits(id),
    barcode VARCHAR(50) NOT NULL,
    roll_id INTEGER NULL,
    result VARCHAR(20) NOT NULL,
    roll_status VARCHAR(30) NULL,
    material_name VARCHAR(200) NULL,
    remaining_quantity NUMERIC NULL,
    scanned_by INTEGER NULL,
    scanned_by_name VARCHAR(200) NULL,
    scanned_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (audit_id, barcode)
);

CREATE INDEX IF NOT EXISTS roll_audit_scans_audit_idx ON roll_audit_scans(audit_id);