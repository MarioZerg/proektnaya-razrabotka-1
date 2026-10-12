-- Снимок полки: где стоит контейнер. Сама картинка лежит в хранилище,
-- здесь только адрес, чтобы список склада не возил байты фото.
ALTER TABLE shelves
    ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Остаток товара по полкам для списка полок: один проход по индексу,
-- а не полный просмотр склада.
CREATE INDEX IF NOT EXISTS idx_gw_in_stock_shelf
    ON goods_warehouse (shelf_id)
    WHERE status = 'in_stock';