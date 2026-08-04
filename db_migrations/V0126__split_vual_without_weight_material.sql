-- Разграничение Вуаль с утяжелителем и без по артикулу:
--   sku LIKE '2vyal%' -> материал «Вуаль без утяжелителя»
--   sku LIKE 'vyal%'  -> материал «Вуаль» (остаётся как есть)
-- Ранее у всех товаров Вуали в marketplace_items.material стояло просто «Вуаль», из-за чего
-- на конвейере и в фильтрах они были неотличимы. Связь для раскроя (marketplace_item_materials)
-- уже настроена правильно, правим только текстовое поле material и синхронизируем заказы,
-- привязанные к этим товарам (orders.marketplace_item_id).

-- 1) Товары справочника: 2vyal* -> «Вуаль без утяжелителя»
UPDATE marketplace_items
SET material = 'Вуаль без утяжелителя', updated_at = now()
WHERE sku LIKE '2vyal%' AND material = 'Вуаль';

-- 2) Синхронизируем существующие заказы, привязанные к конкретному товару-2vyal
UPDATE orders o
SET material = 'Вуаль без утяжелителя'
FROM marketplace_items mi
WHERE o.marketplace_item_id = mi.id
  AND mi.sku LIKE '2vyal%'
  AND o.material = 'Вуаль';