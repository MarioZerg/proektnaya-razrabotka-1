CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id, action);
CREATE INDEX IF NOT EXISTS idx_gw_storage_barcode_norm ON goods_warehouse (upper(trim(storage_barcode)));
CREATE INDEX IF NOT EXISTS idx_orders_order_number_norm ON orders (upper(trim(order_number)));