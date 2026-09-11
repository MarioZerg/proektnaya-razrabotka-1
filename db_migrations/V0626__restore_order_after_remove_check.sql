-- ВОЗВРАТ ЗАКАЗА 2000065880431-249 ПОСЛЕ ПРОВЕРКИ.
--
-- Заказ был удалён проверочным вызовом новой кнопки «Убрать из состава».
-- Проверка подтвердила, что кнопка работает, но сам заказ входит в боевую
-- поставку 1307 и должен остаться в плане производства: решение о его удалении
-- принимает менеджер, а не проверка. Заводим обратно ровно в том виде, в каком
-- он был — «Новый», без исполнителя и без раскроя.
INSERT INTO orders (
    order_number, marketplace, order_type, status, sewing_status,
    product, quantity, source, material, width, height,
    supply_id, marketplace_item_id, shop_id, created_at
)
SELECT
    '2000065880431-249', o.marketplace, o.order_type, 'Новый', 'Новый',
    o.product, o.quantity, o.source, o.material, o.width, o.height,
    o.supply_id, o.marketplace_item_id, o.shop_id, o.created_at
FROM orders o
WHERE o.order_number = '2000065880431-248'
LIMIT 1;
