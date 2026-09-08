-- Тестовый рулон под перепроверку правила «свободный остаток мешает закрытию».
INSERT INTO rolls (barcode, material_id, workshop_id, shift_number,
                   initial_quantity, remaining_quantity, status, accepted_at,
                   cost_per_unit, shortage_norm_percent, packer_returned_quantity)
VALUES ('QA-TEST-LEN-3', 2, 7, 1, 100.000, 8.000, 'in_workshop', now(), 100.0000, 2.000, 3.000)
ON CONFLICT (barcode) DO NOTHING;
