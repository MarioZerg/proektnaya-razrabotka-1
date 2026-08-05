-- Интеграция с Яндекс Маркетом.
-- Особенность площадки: покупатель может заказать несколько вещей одним заказом, и на все
-- вещи такого заказа Яндекс выдаёт ОДИН ярлык-стикер. Разрывать такой заказ между разными
-- закройщиками и швеями нельзя — иначе вещи разъедутся по цеху и их не собрать к отгрузке.
-- Поэтому храним ключ группировки: все вещи одного заказа Яндекса получают общий group_key
-- и едут по производству вместе.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS ym_order_id BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ym_status VARCHAR(50);

-- Общий ключ для вещей одного заказа покупателя (например 'YM-12345').
ALTER TABLE orders ADD COLUMN IF NOT EXISTS group_key VARCHAR(80);
-- Сколько всего вещей в заказе и какая это по счёту — чтобы в цеху видели «1 из 3».
ALTER TABLE orders ADD COLUMN IF NOT EXISTS group_size INT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS group_position INT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_ym_order_pos_uniq
    ON orders (ym_order_id, group_position)
    WHERE ym_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_group_key_idx ON orders (group_key) WHERE group_key IS NOT NULL;
