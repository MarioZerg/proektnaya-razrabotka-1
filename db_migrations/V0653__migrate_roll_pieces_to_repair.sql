-- Переносим ранее распущенные куски из рулонов в склад перешива.
--
-- ЗАЧЕМ. Куски, «распущенные» упаковщицами, растворились в метраже рулонов:
-- закройщик видел обезличенные метры вместо конкретных отрезов и не мог
-- подобрать кусок под заказ. Размеры при этом сохранились в заказе-источнике,
-- поэтому куски восстановимы.
--
-- ЧТО ПЕРЕНОСИМ. Только куски из рулонов, которые ЕЩЁ НЕ ИЗРАСХОДОВАНЫ:
-- рулон в цехе (in_workshop) или на складе (in_storage). По закрытым рулонам
-- материал уже ушёл в работу — вернуть такой кусок значит показать закройщику
-- отрез, которого физически нет.
--
-- Цех и смену берём у рулона, в который кусок попал: перешив доступен всем
-- сменам цеха, но кто отправил — сохраняем для разбора.
INSERT INTO repair_fabric_pieces (
    goods_warehouse_id, material_id, material, width, height,
    workshop_id, shift_number, created_at, status, comment
)
SELECT DISTINCT ON (gw.id)
    gw.id,
    m.id,
    o.material,
    o.width,
    o.height,
    r.workshop_id,
    r.shift_number,
    gw.received_at,
    'available',
    'Перенесено из рулона ' || r.barcode
FROM goods_warehouse gw
JOIN orders o ON o.id = COALESCE(gw.reserved_order_id, gw.order_id)
LEFT JOIN materials m ON m.name = o.material
JOIN rolls r ON r.material_id = m.id
    AND r.status IN ('in_workshop', 'in_storage')
    AND COALESCE(r.packer_returned_quantity, 0) > 0
WHERE gw.status = 'returned_to_roll'
  AND o.width IS NOT NULL
  AND o.height IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM repair_fabric_pieces p WHERE p.goods_warehouse_id = gw.id
  )
ORDER BY gw.id, r.id DESC;
