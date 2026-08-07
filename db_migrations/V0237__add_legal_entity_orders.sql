-- Заказы юридических лиц (B2B) с OZON.
-- OZON отдаёт реквизиты покупателя-компании в блоке legal_info отправления,
-- но раньше мы его не запрашивали, и заказ выглядел как обычный розничный.
-- Теперь помечаем такие заказы, чтобы цех видел пометку прямо на конвейере.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_legal_entity BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legal_company_name VARCHAR(300),
  ADD COLUMN IF NOT EXISTS legal_inn VARCHAR(20);

-- Быстрый отбор заказов юрлиц в фильтре конвейера.
CREATE INDEX IF NOT EXISTS idx_orders_legal_entity
  ON orders (is_legal_entity) WHERE is_legal_entity = true;