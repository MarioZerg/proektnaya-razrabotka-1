-- Кто наклеил ярлык маркетплейса.
--
-- Раньше это имя жило только в журнале действий: чтобы понять, кто стикеровал вещь,
-- приходилось листать историю. В поставке нужно видеть сразу — кладовщик собирает
-- короб и должен знать, к кому идти с вопросом по конкретной вещи.
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS shipping_labeled_by INTEGER;
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS shipping_labeled_by_name TEXT;

-- Заполняем задним числом из журнала: там записан автор каждой стикеровки.
UPDATE goods_warehouse gw
SET shipping_labeled_by = a.user_id,
    shipping_labeled_by_name = a.user_name
FROM (
    SELECT DISTINCT ON (entity_id) entity_id, user_id, user_name
    FROM audit_log
    WHERE action = 'ship_label' AND entity_type = 'goods_warehouse'
    ORDER BY entity_id, created_at DESC
) a
WHERE a.entity_id = gw.id
  AND gw.shipping_labeled_at IS NOT NULL
  AND gw.shipping_labeled_by_name IS NULL;
