-- Живой рулон ДРУГОГО материала (тесьма) для проверки запрета «вуаль на сетку».
INSERT INTO rolls (barcode, material_id, workshop_id, shift_number,
                   initial_quantity, remaining_quantity, status, accepted_at,
                   cost_per_unit, shortage_norm_percent)
VALUES ('QA-TEST-TESMA-2', 6, 7, 1, 50.000, 50.000, 'in_workshop', now(), 10.0000, 2.000)
ON CONFLICT (barcode) DO NOTHING;

-- Возвращаем вещь QA-TEST-ORD-2 на перепаковку, чтобы прогнать проверку материала.
UPDATE goods_warehouse SET status = 'repacking', repack_workshop_id = 7
WHERE storage_barcode = 'QA-GW-95763';
