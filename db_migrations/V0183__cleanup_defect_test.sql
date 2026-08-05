-- Проверка учёта брака пройдена: причины подставляются по типу материала, стикер печатается,
-- кладовщик принимает брак по штрихкоду, отчёт считает по сотрудникам и причинам.
-- Убираем тестовую запись и возвращаем списанный метраж в рулон.
UPDATE rolls r SET remaining_quantity = r.remaining_quantity + d.quantity
FROM material_defects d
WHERE d.barcode = 'DF-000001' AND r.id = d.roll_id;

UPDATE shipment_items SET quantity = 0
WHERE shipment_id IN (SELECT shipment_id FROM material_defects WHERE barcode = 'DF-000001');

UPDATE material_defects SET quantity = 0, comment = 'ТЕСТ проверки учёта брака'
WHERE barcode = 'DF-000001';
