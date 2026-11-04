CREATE TABLE IF NOT EXISTS t_p86119184_proektnaya_razrabotk.ozon_posting_geo (
    posting_number TEXT NOT NULL,
    sku BIGINT NOT NULL,
    shop_id INTEGER NOT NULL,
    scheme TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    cluster_from TEXT NULL,
    cluster_to TEXT NULL,
    status TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (posting_number, sku)
);
CREATE INDEX IF NOT EXISTS ozon_posting_geo_shop_created_idx
    ON t_p86119184_proektnaya_razrabotk.ozon_posting_geo (shop_id, created_at);

CREATE TABLE IF NOT EXISTS t_p86119184_proektnaya_razrabotk.ozon_geo_sync (
    shop_id INTEGER NOT NULL,
    scheme TEXT NOT NULL,
    synced_to TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (shop_id, scheme)
);

CREATE TABLE IF NOT EXISTS t_p86119184_proektnaya_razrabotk.sew_supply_plans (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    request_key TEXT NOT NULL UNIQUE,
    cluster_id BIGINT NULL,
    cluster_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'creating',
    pieces INTEGER NOT NULL DEFAULT 0,
    from_stock INTEGER NOT NULL DEFAULT 0,
    to_sew INTEGER NOT NULL DEFAULT 0,
    localization_now NUMERIC(6, 2) NULL,
    localization_after NUMERIC(6, 2) NULL,
    supply_id INTEGER NULL,
    items JSONB NULL,
    created_by INTEGER NULL,
    created_by_name TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);