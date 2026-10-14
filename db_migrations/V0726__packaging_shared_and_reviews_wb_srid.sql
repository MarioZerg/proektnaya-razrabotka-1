-- Повтор V0724 + V0725 одним файлом (в проде они не были применены). Безопасен при повторном запуске.
ALTER TABLE rolls DROP CONSTRAINT IF EXISTS rolls_workshop_requires_shift;

ALTER TABLE rolls DROP CONSTRAINT IF EXISTS rolls_workshop_requires_workshop;

ALTER TABLE rolls ADD CONSTRAINT rolls_workshop_requires_workshop
CHECK (status <> 'in_workshop' OR workshop_id IS NOT NULL);

UPDATE rolls r
SET shift_number = NULL
FROM materials m
JOIN material_types mt ON mt.id = m.type_id
WHERE r.material_id = m.id
  AND mt.name = 'Упаковка'
  AND r.status = 'in_workshop'
  AND r.shift_number IS NOT NULL;

UPDATE shipments s
SET shift_number = NULL
WHERE s.type = 'to_workshop'
  AND s.status IN ('Новый', 'Отправлено')
  AND s.shift_number IS NOT NULL
  AND EXISTS (SELECT 1 FROM shipment_items si WHERE si.shipment_id = s.id)
  AND NOT EXISTS (
    SELECT 1
    FROM shipment_items si
    JOIN materials m ON m.id = si.material_id
    JOIN material_types mt ON mt.id = m.type_id
    WHERE si.shipment_id = s.id
      AND mt.name <> 'Упаковка'
  );

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS wb_srid VARCHAR(120) NULL;
CREATE INDEX IF NOT EXISTS ix_reviews_wb_srid ON reviews (wb_srid) WHERE wb_srid IS NOT NULL;