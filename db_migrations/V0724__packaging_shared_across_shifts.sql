-- Пакеты и этикетки (тип «Упаковка») — общий материал цеха на все смены.
-- shift_number IS NULL у рулона в цехе = пул на весь цех, не на конкретную смену.
-- Ткань и тесьма по-прежнему обязаны иметь номер смены (проверяет приложение).

ALTER TABLE rolls DROP CONSTRAINT IF EXISTS rolls_workshop_requires_shift;

ALTER TABLE rolls ADD CONSTRAINT rolls_workshop_requires_workshop
CHECK (status <> 'in_workshop' OR workshop_id IS NOT NULL);

-- Живые коробки упаковки в цехе переводим в общий пул.
UPDATE rolls r
SET shift_number = NULL
FROM materials m
JOIN material_types mt ON mt.id = m.type_id
WHERE r.material_id = m.id
  AND mt.name = 'Упаковка'
  AND r.status = 'in_workshop'
  AND r.shift_number IS NOT NULL;

-- Незакрытые заявки, где все позиции — упаковка: смена не нужна.
UPDATE shipments s
SET shift_number = NULL
WHERE s.type = 'to_workshop'
  AND s.status IN ('Новый', 'Отправлено')
  AND s.shift_number IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM shipment_items si WHERE si.shipment_id = s.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM shipment_items si
    JOIN materials m ON m.id = si.material_id
    JOIN material_types mt ON mt.id = m.type_id
    WHERE si.shipment_id = s.id
      AND mt.name <> 'Упаковка'
  );
