ALTER TABLE orders ADD COLUMN IF NOT EXISTS marketplace_created_at TIMESTAMP;

COMMENT ON COLUMN orders.marketplace_created_at IS 'Дата и время создания заказа на маркетплейсе (WB createdAt, Ozon in_process_at) — по ней считается, сколько времени заказ ждёт';

CREATE INDEX IF NOT EXISTS idx_orders_marketplace_created_at ON orders (marketplace_created_at);