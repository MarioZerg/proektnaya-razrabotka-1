-- Проверочные записи брака: убеждаемся, что кладовщик видит закройщика, причину,
-- метраж, материал, рулон и поставщика, и что крупный кусок (от 2 пог.м) выделяется.
-- Записи временные, после проверки будут помечены принятыми.
INSERT INTO t_p86119184_proektnaya_razrabotk.material_defects
    (barcode, roll_id, material_id, user_id, user_name, user_role, quantity,
     reason_code, reason_label, comment)
SELECT 'DF-CHECK1', r.id, r.material_id, 10, 'Андрей', 'cutter', 3.5,
       'fabric_holes', 'Дырки', 'Дырки по всей ширине полотна'
FROM t_p86119184_proektnaya_razrabotk.rolls r WHERE r.id = 18
ON CONFLICT DO NOTHING;

INSERT INTO t_p86119184_proektnaya_razrabotk.material_defects
    (barcode, roll_id, material_id, user_id, user_name, user_role, quantity,
     reason_code, reason_label)
SELECT 'DF-CHECK2', r.id, r.material_id, 10, 'Андрей', 'cutter', 0.4,
       'fabric_snags', 'Затяжки'
FROM t_p86119184_proektnaya_razrabotk.rolls r WHERE r.id = 10
ON CONFLICT DO NOTHING;
