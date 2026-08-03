-- OZON FBS интеграция: связь заказа в системе с отправлением OZON.
-- ozon_posting_number — номер отправления OZON (posting_number из API), уникален,
-- нужен для чтения статуса и защиты от дублей при повторной синхронизации.
-- ozon_status — последний известный статус отправления на стороне OZON (только чтение).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ozon_posting_number VARCHAR(50) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ozon_status VARCHAR(50) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_ozon_posting ON orders (ozon_posting_number) WHERE ozon_posting_number IS NOT NULL;
