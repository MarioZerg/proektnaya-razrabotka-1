-- Тестовый рулон под проверку сценария «свободный остаток мешает закрытию».
--
-- Рулон намеренно с остатком 5 м при пороге закрытия 20 м: по текущим правилам
-- закройщик может его закрыть. Дальше проверяем, что произойдёт, если упаковщица
-- вернёт на него кусок материала и остаток вырастет.

INSERT INTO rolls (barcode, material_id, workshop_id, shift_number,
                   initial_quantity, remaining_quantity, status, accepted_at,
                   cost_per_unit, shortage_norm_percent)
VALUES ('QA-TEST-LEN-2', 2, 7, 1, 100.000, 5.000, 'in_workshop', now(), 100.0000, 2.000)
ON CONFLICT (barcode) DO NOTHING;
