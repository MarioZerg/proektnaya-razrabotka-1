-- Связь нашей поставки OZON FBO с заявкой на поставку на стороне OZON (supply_order_id).
-- Нужно, чтобы «выбор заявки» не создавал дубли и мы знали, из какой заявки OZON пришёл состав.
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS ozon_supply_order_id BIGINT NULL;
CREATE INDEX IF NOT EXISTS ix_supplies_ozon_order ON marketplace_supplies (ozon_supply_order_id) WHERE ozon_supply_order_id IS NOT NULL;
