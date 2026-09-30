-- ТЕСЬМА «4 СМ ХБ» БОЛЬШЕ НЕ НУЖНА.
--
-- В карточках товара заведена обычная «Тесьма 4 см». ХБ завели отдельно, и
-- выбор тесьмы на стикеровке брал её из справочника первой (по пометке «ХБ»
-- в названии) — швея списывала не ту ленту, что стоит в составе. Все ссылки
-- переносим на обычную 4 см и строку ХБ из справочника убираем.
--
-- Историю расхода тоже переписываем: иначе после удаления материала миграция
-- упрётся в внешние ключи, а отчёты продолжат показывать материал, которого
-- в цехе уже нет.

DO $$
DECLARE
  hb_id integer;
  plain_id integer;
BEGIN
  SELECT id INTO hb_id
  FROM materials
  WHERE name ILIKE 'тесьма 4 см хб'
     OR name ILIKE 'тесьма 4см хб'
     OR name ILIKE 'тесьма 4 см х/б'
  ORDER BY id
  LIMIT 1;

  SELECT id INTO plain_id
  FROM materials
  WHERE name ~* '(^|[^0-9])4[[:space:]]*(см|cm)'
    AND name !~* 'хб|х/б'
  ORDER BY id
  LIMIT 1;

  IF hb_id IS NULL OR plain_id IS NULL OR hb_id = plain_id THEN
    RETURN;
  END IF;

  -- Состав карточки: если обычная 4 см уже есть, строку ХБ не дублируем.
  DELETE FROM marketplace_item_materials hb
  WHERE hb.material_id = hb_id
    AND EXISTS (
      SELECT 1 FROM marketplace_item_materials plain
      WHERE plain.marketplace_item_id = hb.marketplace_item_id
        AND plain.material_id = plain_id
        AND plain.workshop_id IS NOT DISTINCT FROM hb.workshop_id
    );
  UPDATE marketplace_item_materials
  SET material_id = plain_id
  WHERE material_id = hb_id;

  DELETE FROM material_shops hb
  WHERE hb.material_id = hb_id
    AND EXISTS (
      SELECT 1 FROM material_shops plain
      WHERE plain.shop_id = hb.shop_id
        AND plain.material_id = plain_id
    );
  UPDATE material_shops
  SET material_id = plain_id
  WHERE material_id = hb_id;

  DELETE FROM supplier_prices hb
  WHERE hb.material_id = hb_id
    AND EXISTS (
      SELECT 1 FROM supplier_prices plain
      WHERE plain.supplier_id = hb.supplier_id
        AND plain.material_id = plain_id
    );
  UPDATE supplier_prices
  SET material_id = plain_id
  WHERE material_id = hb_id;

  DELETE FROM salary_rates hb
  WHERE hb.material_id = hb_id
    AND EXISTS (
      SELECT 1 FROM salary_rates plain
      WHERE plain.workshop_id = hb.workshop_id
        AND plain.role = hb.role
        AND COALESCE(plain.width, 0) = COALESCE(hb.width, 0)
        AND plain.material_id = plain_id
    );
  UPDATE salary_rates
  SET material_id = plain_id
  WHERE material_id = hb_id;

  UPDATE rolls SET material_id = plain_id WHERE material_id = hb_id;
  UPDATE order_material_usage SET material_id = plain_id WHERE material_id = hb_id;
  UPDATE material_movements SET material_id = plain_id WHERE material_id = hb_id;
  UPDATE shipment_items SET material_id = plain_id WHERE material_id = hb_id;
  UPDATE material_defects SET material_id = plain_id WHERE material_id = hb_id;
  UPDATE repair_fabric_pieces SET material_id = plain_id WHERE material_id = hb_id;
  UPDATE auto_order_blocks SET material_id = plain_id WHERE material_id = hb_id;

  DELETE FROM materials WHERE id = hb_id;
END $$;
