CREATE UNIQUE INDEX IF NOT EXISTS uq_gw_active_reserved_order
ON goods_warehouse (reserved_order_id)
WHERE reserved_order_id IS NOT NULL AND shipped_at IS NULL AND status NOT IN ('shipped', 'lost');