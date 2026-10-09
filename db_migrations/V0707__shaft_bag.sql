-- Угольная шахта вариков.
-- Общий мешок: +10 за заказ, закрытый в «Готовые», потолок 72355.
-- Швея со шляпой заглядывает один раз за 15, 16 и 17 число, с 17:00 до 18:00.

CREATE TABLE IF NOT EXISTS shaft_bag (
    id INTEGER PRIMARY KEY DEFAULT 1,
    amount INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO shaft_bag (id, amount) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS shaft_contributions (
    order_id INTEGER PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shaft_claims (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    user_name TEXT,
    claim_date DATE NOT NULL,
    percent INTEGER NOT NULL,
    payout INTEGER NOT NULL,
    bag_before INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,
    paid_by INTEGER,
    cash_tx_id INTEGER,
    UNIQUE (user_id, claim_date)
);

CREATE TABLE IF NOT EXISTS shaft_preview (
    user_id INTEGER NOT NULL,
    claim_date DATE NOT NULL,
    percent INTEGER NOT NULL,
    PRIMARY KEY (user_id, claim_date)
);

COMMENT ON TABLE shaft_bag IS
 'Общий мешок шахты. Растёт на 10 за «Готовые», не выше 72355. Премия списывается отсюда.';
