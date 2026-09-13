-- Коды ПВЗ на возврат — по магазинам.
--
-- Штрихкод выдачи возвратов принадлежит КАБИНЕТУ продавца: по коду МЕГАТЮЛЬ
-- пункт выдачи не отдаст коробки ДЮНЫ — это разные продавцы. Поэтому код
-- уникален не по площадке, а по паре «магазин + площадка».
ALTER TABLE return_pickup_codes ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(id);

UPDATE return_pickup_codes SET shop_id = (SELECT id FROM shops WHERE code = 'megatul')
WHERE shop_id IS NULL;

-- Старую уникальность по одной площадке снимаем ДО вставки: иначе второй
-- кабинет со своим 'ozon' в таблицу просто не поместится.
ALTER TABLE return_pickup_codes DROP CONSTRAINT IF EXISTS return_pickup_codes_marketplace_code_key;

-- Заводим такой же набор площадок каждому остальному активному магазину,
-- чтобы кладовщику было куда вписать код второго кабинета.
INSERT INTO return_pickup_codes (marketplace_code, title, code_type, daily_refresh, shop_id)
SELECT src.marketplace_code, src.title, src.code_type, src.daily_refresh, s.id
FROM return_pickup_codes src
CROSS JOIN shops s
WHERE src.shop_id = (SELECT id FROM shops WHERE code = 'megatul')
  AND s.is_active = true
  AND s.id <> src.shop_id
  AND NOT EXISTS (
    SELECT 1 FROM return_pickup_codes x
    WHERE x.shop_id = s.id AND x.marketplace_code = src.marketplace_code
  );

ALTER TABLE return_pickup_codes ALTER COLUMN shop_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS return_pickup_codes_shop_mp_uniq
  ON return_pickup_codes (shop_id, marketplace_code);

-- Возвраты тоже принадлежат кабинету: заявка приезжает из конкретного кабинета,
-- и забирать её надо по его коду.
ALTER TABLE marketplace_returns ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(id);

UPDATE marketplace_returns SET shop_id = (SELECT id FROM shops WHERE code = 'megatul')
WHERE shop_id IS NULL;

CREATE INDEX IF NOT EXISTS marketplace_returns_shop_idx
  ON marketplace_returns (shop_id, marketplace, status);
