-- ТЕСТ фильтрации рулонов по ролям: заводим по одному рулону каждого типа в Цех №1,
-- смену 1. Проверим, что закройщик видит только тюль, швея — только тесьму,
-- упаковщица — пакеты И этикетки. После проверки рулоны будут закрыты.
INSERT INTO rolls (barcode, material_id, initial_quantity, remaining_quantity, status,
                   workshop_id, shift_number)
VALUES
 ('TESTROLL-TUL',  (SELECT id FROM materials WHERE name = 'Вуаль' LIMIT 1),        50, 50, 'in_workshop', 1, 1),
 ('TESTROLL-TESMA',(SELECT id FROM materials WHERE name = 'Тесьма 4 см' LIMIT 1), 100,100, 'in_workshop', 1, 1),
 ('TESTROLL-PAKET',(SELECT id FROM materials WHERE name = 'Пакет 30х35' LIMIT 1), 200,200, 'in_workshop', 1, 1),
 ('TESTROLL-ETIK', (SELECT id FROM materials WHERE name = 'Этикетка на пакет 58х40' LIMIT 1), 300,300,'in_workshop',1,1)
ON CONFLICT (barcode) DO NOTHING;