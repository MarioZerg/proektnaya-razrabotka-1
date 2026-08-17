-- 1. Поставщик у КАЖДОЙ позиции приёмки.
-- Раньше поставщик был один на всю приёмку, поэтому машину с материалом от трёх
-- поставщиков приходилось заводить тремя документами — и логистику за одну поездку
-- делили руками. Теперь в одной приёмке можно указать, какой материал от кого приехал.
ALTER TABLE shipment_items ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id);

-- Старым позициям проставляем поставщика всей приёмки — ничего не теряется.
UPDATE shipment_items si
SET supplier_id = sh.supplier_id
FROM shipments sh
WHERE sh.id = si.shipment_id
  AND si.supplier_id IS NULL
  AND sh.supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipment_items_supplier ON shipment_items (supplier_id);

-- 2. Штрихкоды, забронированные до подтверждения администратором.
-- Нужны, чтобы кладовщик мог напечатать и наклеить стикеры сразу при разгрузке машины,
-- не дожидаясь админа. Храним списком через запятую: по одному коду на рулон позиции.
ALTER TABLE shipment_items ADD COLUMN IF NOT EXISTS reserved_barcodes TEXT;

-- 3. Счётчик штрихкодов по типу материала.
-- Раньше номер вычислялся как «максимум среди созданных рулонов». Пока стикеры печатались
-- только после подтверждения, это работало. Теперь коды выдаются заранее, и рулона с таким
-- номером ещё нет — без отдельного счётчика два кладовщика получили бы одинаковые номера
-- на разных рулонах.
CREATE TABLE IF NOT EXISTS barcode_counters (
    type_id INTEGER PRIMARY KEY,
    last_seq INTEGER NOT NULL DEFAULT 0
);

-- Стартуем счётчик с максимального уже выданного номера, чтобы не повторить старые коды.
INSERT INTO barcode_counters (type_id, last_seq)
SELECT split_part(barcode, '-', 1)::int AS type_id,
       MAX(split_part(barcode, '-', 2)::int) AS last_seq
FROM rolls
WHERE barcode ~ '^[0-9]+-[0-9]+$'
GROUP BY 1
ON CONFLICT (type_id) DO UPDATE SET last_seq = GREATEST(barcode_counters.last_seq, EXCLUDED.last_seq);
