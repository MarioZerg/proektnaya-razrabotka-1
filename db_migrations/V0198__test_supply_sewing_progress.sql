-- Временно: помечаем часть изделий тестовой поставки сшитыми и одно отменённым,
-- чтобы проверить колонку прогресса пошива в списке поставок.
UPDATE orders SET sewing_status = 'Готовые'
WHERE supply_id = 35 AND order_number IN ('00000-01', '00000-02');

UPDATE orders SET status = 'Отменён'
WHERE supply_id = 35 AND order_number = '00000-04';