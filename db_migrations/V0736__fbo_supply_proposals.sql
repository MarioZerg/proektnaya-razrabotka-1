-- Автопредложения FBO. Пока строка open_hold, этот GW нельзя отдать
-- в другую поставку, в подбор и во вторую предложку.
-- Предложения не удаляются, только меняют статус (accepted/rejected),
-- поэтому каскад на удаление не нужен.

CREATE TABLE IF NOT EXISTS fbo_supply_proposals (
    id serial PRIMARY KEY,
    shop_id integer NOT NULL,
    cluster text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    ozon_draft_id bigint,
    ozon_warehouse_id bigint,
    gate_date date,
    gate_timeslot text,
    gazelka_date date,
    supply_id integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz,
    decided_by integer,
    CONSTRAINT fbo_supply_proposals_status
        CHECK (status IN ('open', 'accepted', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS fbo_supply_proposals_one_open
    ON fbo_supply_proposals (shop_id, cluster)
    WHERE status = 'open';

CREATE TABLE IF NOT EXISTS fbo_supply_proposal_items (
    id serial PRIMARY KEY,
    proposal_id integer NOT NULL REFERENCES fbo_supply_proposals(id),
    goods_warehouse_id integer NOT NULL,
    marketplace_item_id integer,
    popular boolean NOT NULL DEFAULT false,
    open_hold boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS fbo_supply_proposal_items_one_hold
    ON fbo_supply_proposal_items (goods_warehouse_id)
    WHERE open_hold;
