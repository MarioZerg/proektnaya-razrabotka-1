ALTER TABLE t_p86119184_proektnaya_razrabotk.ozon_geo_sync ADD COLUMN IF NOT EXISTS cursor TEXT NULL;

CREATE TABLE IF NOT EXISTS t_p86119184_proektnaya_razrabotk.ozon_cluster_stock (
    shop_id INTEGER NOT NULL,
    cluster_id BIGINT NOT NULL,
    cluster_name TEXT NOT NULL,
    sku BIGINT NOT NULL,
    available INTEGER NOT NULL DEFAULT 0,
    in_transit INTEGER NOT NULL DEFAULT 0,
    requested INTEGER NOT NULL DEFAULT 0,
    grade TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (shop_id, cluster_id, sku)
);