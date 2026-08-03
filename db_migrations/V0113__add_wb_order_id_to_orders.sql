-- WB FBS: связь заказа в системе со сборочным заданием WildBerries.
-- wb_order_id — id сборочного задания WB (из GET /api/v3/orders/new), нужен для
-- дальнейших шагов (добавление в поставку, стикеры, статусы) и защиты от дублей при повторной синхронизации.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wb_order_id BIGINT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_wb_order_id ON orders (wb_order_id) WHERE wb_order_id IS NOT NULL;
