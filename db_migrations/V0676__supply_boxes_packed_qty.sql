-- Снимок количества в коробе на момент закрытия.
--
-- После отгрузки FBO следующий скан того же артикула в новую поставку стирал
-- строки marketplace_supply_items у уехавшей заявки: завершённая поставка
-- «не держит» вещь, и короба показывали 0 шт., хотя на OZON грузоместа полные.
-- packed_qty фиксирует, сколько штук было в коробе, когда его заклеили.

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
