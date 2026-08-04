-- Отзывы с маркетплейсов (OZON и WB, FBS). Отзыв привязывается к нашему FBS-заказу:
--   OZON — по posting_number (orders.ozon_posting_number),
--   WB   — по srid/orderId (orders.wb_order_id), а если заказ не найден — по товару (product_sku).
-- Производственный цикл (кто кроил/сшил/упаковал) и даты берём из связанного заказа при выборке.
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    marketplace VARCHAR(20) NOT NULL,          -- 'OZON' | 'WB'
    external_id VARCHAR(120) NOT NULL,         -- id отзыва на площадке (защита от дублей)
    order_id INTEGER NULL REFERENCES orders(id),  -- сопоставленный FBS-заказ (если найден)
    product_sku VARCHAR(120) NULL,             -- артикул/ozon_sku/wb_sku товара из отзыва
    product_name VARCHAR(300) NULL,            -- название товара из отзыва
    rating INTEGER NULL,                       -- 1..5
    text TEXT NULL,
    review_date TIMESTAMP NULL,                -- дата отзыва (когда написан покупателем)
    synced_at TIMESTAMP NOT NULL DEFAULT now(),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_reviews_mp_extid ON reviews(marketplace, external_id);
CREATE INDEX IF NOT EXISTS ix_reviews_order ON reviews(order_id);
CREATE INDEX IF NOT EXISTS ix_reviews_date ON reviews(review_date);