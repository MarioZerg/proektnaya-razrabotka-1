-- Снимок количества в коробе на момент закрытия (повтор V0676: колонка
-- не доехала до БД, из-за чего чтение карточки поставки падало на
-- SELECT ... packed_qty и короба с товарами не отображались вовсе).

ALTER TABLE marketplace_supply_boxes
    ADD COLUMN IF NOT EXISTS packed_qty integer NULL;

UPDATE marketplace_supply_boxes b
SET packed_qty = (
    SELECT COUNT(*) FROM marketplace_supply_items i WHERE i.box_id = b.id
)
WHERE b.closed_at IS NOT NULL
  AND b.packed_qty IS NULL
  AND EXISTS (
      SELECT 1 FROM marketplace_supply_items i WHERE i.box_id = b.id
  );
