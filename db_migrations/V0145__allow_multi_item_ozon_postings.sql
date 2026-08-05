-- Отправление OZON FBS может содержать несколько товаров или одну позицию в нескольких
-- экземплярах. Каждая штука должна стать отдельным заказом на конвейере, но уникальный
-- индекс по ozon_posting_number это запрещал: до сих пор из такого отправления попадала
-- в производство ТОЛЬКО ПЕРВАЯ штука, остальные молча терялись.
-- Снимаем уникальность с posting_number, оставляя обычный индекс для быстрого поиска:
-- защита от повторного импорта обеспечивается уникальным order_number вида
-- "{posting}-{артикул}-{номер штуки}" (как уже сделано в FBO).
DROP INDEX IF EXISTS ux_orders_ozon_posting;
CREATE INDEX IF NOT EXISTS idx_orders_ozon_posting ON orders (ozon_posting_number)
  WHERE ozon_posting_number IS NOT NULL;
