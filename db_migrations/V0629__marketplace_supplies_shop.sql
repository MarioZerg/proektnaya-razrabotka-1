-- Разделение поставок на маркетплейс по магазинам.
--
-- Кладовщик собирает FBS отдельно для МЕГАТЮЛЬ и отдельно для ДЮНЫ: это разные
-- кабинеты на площадке, вещи одного магазина в поставку другого не примут.
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS shop_id INTEGER REFERENCES shops(id);

-- Все поставки, созданные до появления ДЮНЫ, относятся к МЕГАТЮЛЬ.
UPDATE marketplace_supplies SET shop_id = (SELECT id FROM shops WHERE code = 'megatul')
WHERE shop_id IS NULL;

ALTER TABLE marketplace_supplies ALTER COLUMN shop_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS marketplace_supplies_shop_idx
  ON marketplace_supplies (shop_id, type, status);
