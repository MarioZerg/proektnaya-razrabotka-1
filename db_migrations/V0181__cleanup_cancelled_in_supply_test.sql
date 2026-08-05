-- Проверка отмен в поставке пройдена: отменённый заказ определяется, отгрузка блокируется,
-- вещь уезжает на полку; для связки Яндекса на полку уходит вся связка целиком.
-- Убираем тестовые поставки и заказы.
UPDATE marketplace_supplies
SET status = 'Выполнена', completed_at = now(), comment = comment || ' (проверка завершена)'
WHERE comment IN ('ТЕСТ отмены в поставке', 'ТЕСТ отмены в связке');

UPDATE orders SET status = 'Отменён', sewing_status = 'Отменён'
WHERE order_number LIKE 'CANC-%' OR group_key = 'YM-333333';

UPDATE goods_warehouse SET status = 'lost', lost_reason = 'Тестовые данные проверки отмен',
                           lost_at = now()
WHERE storage_barcode LIKE 'GWC-%' OR storage_barcode LIKE 'GWY-%';
