-- Лист сборки OZON 08.10 (146 отправлений, закрыты вручную, V0702): списываем тесьму,
-- пакеты и этикетки по составу товара — тогда списали только ткань.
-- Смена заказа — по рулону ткани, с которого его кроили.
-- ШАГ 2: остаток 2-й смены (тесьма 6 см, этикетки 58х40) — с рулонов/пачек 1-й смены,
-- по согласованию с владельцем 13.10. Если не хватит — команда падает, ничего не меняет.

WITH dem0 AS (
    SELECT o.id AS order_id, sh.shift_number AS sh, mim.material_id, mim.quantity AS qty
      FROM orders o
      JOIN LATERAL (SELECT r2.shift_number FROM order_material_usage u2 JOIN rolls r2 ON r2.id = u2.roll_id
                      JOIN materials m2 ON m2.id = u2.material_id JOIN material_types t2 ON t2.id = m2.type_id
                     WHERE u2.order_id = o.id AND t2.name = 'Тюль' ORDER BY u2.id LIMIT 1) sh ON true
      JOIN marketplace_item_materials mim ON mim.marketplace_item_id = o.marketplace_item_id AND (mim.workshop_id IS NULL OR mim.workshop_id = 1)
      JOIN materials m ON m.id = mim.material_id JOIN material_types mt ON mt.id = m.type_id
     WHERE o.order_number IN ('0101677202-0098-3','0109598510-0231-1','0110937240-0112-4','0111503371-0424-1','0115729533-0654-1','0115729533-0654-3','0121303463-0098-1','0123276487-0009-1','0124601672-0118-1','0125402890-0242-2','0125402890-0242-5','0129246842-0237-2','0133430066-0107-1','0134047123-0316-1','0134047123-0317-1','0134572448-0006-2','0139867120-0345-1','0141473419-0565-1','0141473419-0565-3','0145923587-0033-1','0148294214-0425-1','0149914434-0374-1','0152647080-1449-1','0155289966-0119-15','0155289966-0119-6','0159049906-0021-1','0159049906-0021-3','0172296623-0048-2','0181845629-0014-1','0188063759-0097-1','0188254369-0048-4','0190923853-0131-1','0197507387-0266-1','0213000436-1037-2','0230676966-0012-3','0239784637-0049-1','0243070171-0015-1','0243070171-0015-3','0256659550-0048-1','0267153958-0063-1','0286907880-0013-1','06974670-0827-1','09103277-0426-4','09103277-0426-7','10308268-0314-2','15912666-1883-1','16623100-1251-2','17978126-0078-1','18088550-0066-1','18566038-0136-2','19588042-0529-1','19588042-0529-3','19599951-0366-1','19599951-0366-3','19599951-0366-5','19599951-0366-7','29867085-0287-3','29867085-0287-7','30956967-0395-1','30956967-0395-3','31102359-0209-1','32052852-0255-1','32183255-0569-1','33344707-0231-1','34419807-0750-1','34701169-0082-1','37217910-0098-1','37279108-0237-2','38292992-0093-4','38476382-0153-1','38476382-0153-3','38476382-0153-5','38476382-0153-7','39184049-0444-1','39395270-0633-2','39415490-0061-1','39649051-0772-1','40319488-0334-1','40535972-0200-1','40761231-0462-1','41526382-0311-1','42483999-0452-1','42483999-0452-3','42597547-0462-1','43642303-0253-1','43833283-1316-1','46222568-0194-1','46581572-0888-1','47557337-0063-1','47557337-0063-3','47890312-0204-1','48426023-0486-1','48843003-0361-1','49362894-0674-2','49987002-1061-3','51087103-1350-1','51118020-0773-1','51139221-0152-1','51740964-0681-1','52505149-0290-1','56085233-0313-1','56736297-0084-2','56736297-0084-5','56736297-0084-7','57092791-0197-3','57395056-0360-2','58709851-1305-1','60141770-0135-1','62297049-0193-3','62297049-0193-5','62791355-0142-3','62791355-0143-1','63043221-0023-4','63251369-0244-1','64280998-0132-2','66956385-1248-1','68530978-0446-1','73599528-0338-5','73887574-0059-3','74142715-0709-1','75009678-0212-1','75009678-0212-3','75009678-0212-5','75009678-0212-7','75009678-0212-9','75151144-0155-1','76989254-0159-1','80371193-0761-1','80371193-0761-3','80371193-0761-5','82078948-0155-1','83267352-0146-1','83549626-0942-1','86367462-0279-1','86367462-0279-3','88681714-0418-10','89465022-0151-1','89717439-0581-1','91199565-0137-1','91199565-0137-3','91622975-0257-1','95665775-0273-1','96382069-0268-1','96382069-0268-3','98173396-0186-1','98780132-0256-1')
       AND o.sewing_status <> 'Со склада' AND mt.name <> 'Тюль' AND mim.quantity > 0
),
dem1 AS (
    SELECT d.order_id, d.sh, d.material_id,
           round(d.qty - COALESCE((SELECT SUM(u.quantity) FROM order_material_usage u WHERE u.order_id = d.order_id AND u.material_id = d.material_id), 0), 3) AS qty
      FROM dem0 d
),
dem AS (SELECT d.*, SUM(d.qty) OVER (PARTITION BY d.material_id, d.sh ORDER BY d.order_id) - d.qty AS d_from, SUM(d.qty) OVER (PARTITION BY d.material_id, d.sh ORDER BY d.order_id) AS d_to FROM dem1 d WHERE d.qty > 0.0005 AND d.sh = 2 AND d.material_id IN (SELECT id FROM materials WHERE name IN ('Тесьма 6 см', 'Этикетка на пакет 58х40'))),
sup AS (SELECT r.id AS roll_id, r.material_id, 2 AS sh, SUM(r.remaining_quantity) OVER (PARTITION BY r.material_id ORDER BY r.created_at, r.id) - r.remaining_quantity AS s_from, SUM(r.remaining_quantity) OVER (PARTITION BY r.material_id ORDER BY r.created_at, r.id) AS s_to FROM rolls r WHERE r.workshop_id = 1 AND r.status = 'in_workshop' AND r.accepted_at IS NOT NULL AND r.defect_flagged_at IS NULL AND r.removed_at IS NULL AND r.remaining_quantity > 0 AND r.shift_number = 1 AND r.material_id IN (SELECT material_id FROM dem)),
alloc AS (
    SELECT dem.order_id, dem.material_id, dem.sh, sup.roll_id,
           round(LEAST(dem.d_to, sup.s_to) - GREATEST(dem.d_from, sup.s_from), 3) AS take
      FROM dem JOIN sup ON sup.material_id = dem.material_id
     WHERE LEAST(dem.d_to, sup.s_to) - GREATEST(dem.d_from, sup.s_from) > 0.0005
),
got AS (SELECT order_id, material_id, SUM(take) AS got FROM alloc GROUP BY 1, 2),
short AS (SELECT dem.order_id FROM dem LEFT JOIN got g ON g.order_id = dem.order_id AND g.material_id = dem.material_id WHERE COALESCE(g.got, 0) < dem.qty - 0.001),
guard AS (SELECT CASE WHEN count(*) = 0 THEN 0 ELSE ('Не хватает на 1-й смене для заказов: ' || count(*)::text)::int END AS ok FROM short),
roll_take AS (SELECT roll_id, SUM(take) AS t FROM alloc GROUP BY roll_id),
upd AS (
    UPDATE rolls r
       SET remaining_quantity = round(r.remaining_quantity - rt.t, 3),
           status = CASE WHEN r.remaining_quantity - rt.t <= 0.0005 THEN 'completed' ELSE r.status END,
           completed_at = CASE WHEN r.remaining_quantity - rt.t <= 0.0005 THEN now() ELSE r.completed_at END
      FROM roll_take rt
     WHERE r.id = rt.roll_id AND (SELECT ok FROM guard) = 0
    RETURNING r.id
)
INSERT INTO order_material_usage (order_id, material_id, roll_id, quantity, actor_workshop_id, actor_shift_number, is_foreign_shift)
SELECT a.order_id, a.material_id, a.roll_id, a.take, 1, a.sh, true
  FROM alloc a
 WHERE (SELECT count(*) FROM upd) >= 0 AND (SELECT ok FROM guard) = 0;