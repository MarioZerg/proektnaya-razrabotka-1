CREATE INDEX IF NOT EXISTS idx_orders_cut_at ON orders (cut_at) WHERE cut_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_overlocked_at ON orders (overlocked_at) WHERE overlocked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_taken_at ON orders (taken_at) WHERE taken_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_sewn_at_only ON orders (sewn_at) WHERE sewn_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hangers_number ON hangers (number);