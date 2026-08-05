-- Товар, отменённый клиентом, после стикеровки упаковщиком ждёт, пока кладовщик заберёт его
-- из цеха и положит на полку. Для этого нужен отдельный статус ожидания полки.
COMMENT ON COLUMN goods_warehouse.status IS 'awaiting_shelf — отстикерован упаковщиком, ждёт приёма кладовщиком на полку; in_stock — лежит на полке; picking — отобран к подбору; reserved — в поставке; shipped — отгружен; lost — утерян';

-- Какой новый FBS-заказ закрывается этим товаром с полки (автоподбор по товару справочника)
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS reserved_order_id INTEGER;
COMMENT ON COLUMN goods_warehouse.reserved_order_id IS 'Новый заказ маркетплейса, который закрывается этой вещью с полки';

-- Когда вещь подобрана под заказ и когда кладовщик наклеил стикер отправления
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS matched_at TIMESTAMP;
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS shipping_labeled_at TIMESTAMP;

-- Заказ закрыт товаром со склада — на конвейер производства он не попадает
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfilled_from_stock_id INTEGER;
COMMENT ON COLUMN orders.fulfilled_from_stock_id IS 'Запись склада (goods_warehouse), которой закрыт заказ вместо пошива';

-- Товар справочника нужен для точного подбора вещи с полки под новый заказ
CREATE INDEX IF NOT EXISTS idx_orders_marketplace_item_id ON orders (marketplace_item_id);
CREATE INDEX IF NOT EXISTS idx_gw_reserved_order ON goods_warehouse (reserved_order_id);
CREATE INDEX IF NOT EXISTS idx_gw_status ON goods_warehouse (status);