-- Отзывы WB приходят с srid — это rid сборочного задания, а не номер заказа.
-- Номер заказа у нас давно id задания (5425685523), rid вида "eAD.iba…" нигде
-- не хранился, поэтому отзыв не находил заказ и швея/закройщик/упаковщик
-- в вкладке «Отзывы» оставались пустыми.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wb_rid VARCHAR(120) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_wb_rid ON orders (wb_rid) WHERE wb_rid IS NOT NULL;
