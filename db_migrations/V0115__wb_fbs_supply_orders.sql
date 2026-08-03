-- WB FBS интеграция: прямая работа с поставкой на стороне WildBerries.
-- Поставка на WB (supplyId вида WB-GI-...) хранится в wb_supply_id поставки.
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS wb_supply_id VARCHAR(50) NULL;

-- WB FBS сканирует готовый FBS-заказ WB напрямую (без склада готового товара и коробов
-- старой схемы). Связь "заказ в WB-поставке" храним отдельной лёгкой таблицей, чтобы не
-- трогать существующую FBO/FBS-схему через goods_warehouse.
CREATE TABLE IF NOT EXISTS wb_supply_orders (
    id SERIAL PRIMARY KEY,
    supply_id INTEGER NOT NULL REFERENCES marketplace_supplies(id),
    order_id INTEGER NOT NULL REFERENCES orders(id),
    wb_trbx_id VARCHAR(50) NULL,
    sticker_url TEXT NULL,
    sticker_name VARCHAR(255) NULL,
    scanned_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (supply_id, order_id)
);
CREATE INDEX IF NOT EXISTS ix_wb_supply_orders_supply ON wb_supply_orders (supply_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wb_supply_orders_order ON wb_supply_orders (order_id);
