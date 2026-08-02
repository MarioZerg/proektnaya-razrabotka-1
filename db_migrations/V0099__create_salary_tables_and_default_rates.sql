CREATE TABLE salary_rates (
    id SERIAL PRIMARY KEY,
    role VARCHAR(30) NOT NULL,
    material_id INTEGER NULL REFERENCES materials(id),
    width INTEGER NULL,
    rate NUMERIC(12,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_salary_rates_unique ON salary_rates (
    role,
    COALESCE(material_id, 0),
    COALESCE(width, 0)
);

CREATE TABLE salary_payouts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount NUMERIC(12,2) NOT NULL,
    paid_at TIMESTAMP NOT NULL DEFAULT now(),
    paid_by INTEGER NULL REFERENCES users(id),
    period_from DATE NULL,
    period_to DATE NULL
);

CREATE TABLE salary_accruals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type VARCHAR(30) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    order_id INTEGER NULL REFERENCES orders(id),
    shift_session_id INTEGER NULL REFERENCES shift_sessions(id),
    description TEXT NOT NULL,
    accrued_for DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    paid_at TIMESTAMP NULL,
    payout_id INTEGER NULL REFERENCES salary_payouts(id),
    created_by INTEGER NULL REFERENCES users(id)
);

CREATE UNIQUE INDEX idx_salary_accruals_order_type ON salary_accruals(order_id, type) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX idx_salary_accruals_shift_type ON salary_accruals(shift_session_id, type) WHERE shift_session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_salary_accruals_daily ON salary_accruals(user_id, type, accrued_for) WHERE type = 'admin_daily';

CREATE INDEX idx_salary_accruals_user ON salary_accruals(user_id);
CREATE INDEX idx_salary_accruals_paid ON salary_accruals(paid_at);

INSERT INTO salary_rates (role, material_id, rate)
SELECT 'cutter', m.id, 0
FROM materials m JOIN material_types mt ON mt.id = m.type_id WHERE mt.name = 'Тюль';

INSERT INTO salary_rates (role, width, rate) VALUES
    ('sewer', 200, 50),
    ('sewer', 300, 0),
    ('sewer', 400, 0),
    ('sewer', 500, 0),
    ('sewer', 600, 0),
    ('sewer', 700, 0),
    ('sewer', 800, 0);

INSERT INTO salary_rates (role, rate) VALUES ('packer', 4);
INSERT INTO salary_rates (role, rate) VALUES ('storekeeper', 1000);
INSERT INTO salary_rates (role, rate) VALUES ('cleaner', 0);
INSERT INTO salary_rates (role, rate) VALUES ('admin', 0);