-- ВТОРОЙ МАГАЗИН: МЕГАТЮЛЬ и ДЮНА на одном производстве.
--
-- Раньше система знала ровно один магазин: ключи площадок лежали по одному на
-- OZON, WB и Яндекс, а UNIQUE(marketplace_code) прямо запрещал второй кабинет.
-- Теперь магазинов несколько, но цех общий: заказы обоих падают в одну очередь,
-- шьются теми же людьми по тем же тарифам. Разделяем только то, что приходит
-- из кабинета площадки — ключи, товары, заказы.
CREATE TABLE IF NOT EXISTS shops (
    id SERIAL PRIMARY KEY,
    code VARCHAR(30) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    -- Цвет метки в интерфейсе: заказы двух магазинов идут вперемешку, и
    -- швея должна различать их одним взглядом, не вчитываясь.
    color VARCHAR(20) NOT NULL DEFAULT 'slate',
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO shops (code, name, color, sort_order) VALUES
    ('megatul', 'МЕГАТЮЛЬ', 'emerald', 1),
    ('duna',    'ДЮНА',     'sky',     2)
ON CONFLICT (code) DO NOTHING;

-- Ключи площадок теперь принадлежат магазину.
ALTER TABLE marketplace_integrations
ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(id);

-- Всё, что уже настроено, — это МЕГАТЮЛЬ.
UPDATE marketplace_integrations
SET shop_id = (SELECT id FROM shops WHERE code = 'megatul')
WHERE shop_id IS NULL;

-- Снимаем запрет на второй кабинет той же площадки.
ALTER TABLE marketplace_integrations
DROP CONSTRAINT IF EXISTS marketplace_integrations_marketplace_code_key;

-- Пара «магазин + площадка» по-прежнему одна: два ключа OZON у одного
-- магазина — это ошибка ввода, а не сценарий.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_integrations_shop_code_uniq
ON marketplace_integrations (shop_id, marketplace_code);

-- Товары принадлежат магазину: у ДЮНЫ свой ассортимент и свои артикулы.
ALTER TABLE marketplace_items
ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(id);

UPDATE marketplace_items
SET shop_id = (SELECT id FROM shops WHERE code = 'megatul')
WHERE shop_id IS NULL;

CREATE INDEX IF NOT EXISTS marketplace_items_shop_idx
ON marketplace_items (shop_id);

-- Заказы: цех общий, но видно, чей заказ шьём.
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(id);

UPDATE orders
SET shop_id = (SELECT id FROM shops WHERE code = 'megatul')
WHERE shop_id IS NULL;

CREATE INDEX IF NOT EXISTS orders_shop_idx ON orders (shop_id);