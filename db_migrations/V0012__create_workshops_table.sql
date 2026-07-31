CREATE TABLE IF NOT EXISTS workshops (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    shifts_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO workshops (name, is_active, shifts_count) VALUES
    ('Цех №1', true, 2),
    ('Цех №2', true, 1);