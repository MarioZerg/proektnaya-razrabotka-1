-- Проверка завершена успешно: неполный заказ с общим ярлыком отгрузить нельзя, полный
-- отгружается свободно. Убираем тестовую поставку и заказ из рабочих списков.
UPDATE marketplace_supplies
SET status = 'Выполнена', completed_at = now(), comment = 'ТЕСТ (проверка завершена)'
WHERE comment = 'ТЕСТ проверки неполного заказа';

UPDATE orders SET status = 'Отменён', sewing_status = 'Отменён'
WHERE group_key = 'YM-888888';
