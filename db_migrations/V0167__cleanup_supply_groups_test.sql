-- Проверка отображения связок завершена: неполная связка подсвечена жёлтым с указанием,
-- сколько вещей не хватает, собранная — зелёным. Убираем тестовые данные из рабочих списков.
UPDATE marketplace_supplies
SET status = 'Выполнена', completed_at = now(), comment = 'ТЕСТ связок (проверка завершена)'
WHERE comment = 'ТЕСТ отображения связок';

UPDATE orders SET status = 'Отменён', sewing_status = 'Отменён'
WHERE group_key IN ('YM-777001', 'YM-777002');

UPDATE goods_warehouse SET status = 'shipped', shipped_at = now()
WHERE order_id IN (SELECT id FROM orders WHERE group_key IN ('YM-777001', 'YM-777002'));
