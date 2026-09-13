-- Разделение справочника товаров по магазинам.
-- Все карточки, что уже есть в системе, заведены в кабинете МЕГАТЮЛЬ:
-- до появления ДЮНЫ магазин был один, поэтому shop_id никто не заполнял.
UPDATE marketplace_items SET shop_id = (SELECT id FROM shops WHERE code = 'megatul')
WHERE shop_id IS NULL;

-- Дальше карточка без магазина недопустима: иначе товар ДЮНЫ потеряется
-- между вкладками и уедет в поставку не того кабинета.
ALTER TABLE marketplace_items ALTER COLUMN shop_id SET NOT NULL;

-- Артикул уникален внутри магазина, а не глобально: один и тот же
-- vyal3_260 может быть заведён и у МЕГАТЮЛЬ, и у ДЮНЫ — это разные карточки
-- с разными SKU площадок.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_items_shop_sku_idx
  ON marketplace_items (shop_id, sku) WHERE sku IS NOT NULL AND sku <> '';
