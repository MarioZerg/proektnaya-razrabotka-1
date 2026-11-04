ALTER TABLE t_p86119184_proektnaya_razrabotk.ozon_geo_sync ADD COLUMN IF NOT EXISTS window_to TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS t_p86119184_proektnaya_razrabotk.ozon_warehouse_cluster (
    warehouse_name TEXT PRIMARY KEY,
    cluster_id BIGINT NOT NULL,
    cluster_name TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);