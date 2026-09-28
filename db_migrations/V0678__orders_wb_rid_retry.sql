-- Повтор V0675: колонка wb_rid не доехала до БД (миграция сохранилась в
-- репозитории, но в схеме её нет), из-за чего отзывы WB по srid не находят
-- заказ и вкладка «Отзывы» пустая у швеи/закройщика/упаковщика.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wb_rid VARCHAR(120) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_wb_rid ON orders (wb_rid) WHERE wb_rid IS NOT NULL;
