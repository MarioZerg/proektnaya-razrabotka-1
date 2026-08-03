CREATE TABLE marketplace_integrations (
    id SERIAL PRIMARY KEY,
    marketplace_code VARCHAR(30) UNIQUE NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by INTEGER NULL REFERENCES users(id)
);

INSERT INTO marketplace_integrations (marketplace_code, is_enabled, credentials) VALUES
    ('ozon', false, '{}'::jsonb),
    ('wildberries', false, '{}'::jsonb),
    ('yandex_market', false, '{}'::jsonb),
    ('megamarket', false, '{}'::jsonb),
    ('lemana_pro', false, '{}'::jsonb),
    ('avito', false, '{}'::jsonb);