-- Уборка тестовых приёмок после проверки партий и авторства.
--
-- При проверке больших партий (12, 20, 30, 10, 6 штук) завелись служебные вещи
-- id 778–849. Реального товара за ними нет. Часть из них автоподбор уже успел
-- закрепить за настоящими заказами — такие сначала освобождаем, иначе заказ
-- останется ждать вещь, которой не существует, и уедет срок отправления.
UPDATE orders
SET fulfilled_from_stock_id = NULL,
    sewing_status = 'Новый'
WHERE fulfilled_from_stock_id IN (
    SELECT id FROM goods_warehouse WHERE id BETWEEN 778 AND 849
);

UPDATE goods_warehouse
SET status = 'lost',
    lost_reason = 'Тестовая приёмка, товара физически нет',
    lost_at = now(),
    shelf_id = NULL,
    reserved_order_id = NULL,
    matched_at = NULL,
    shipping_labeled_at = NULL
WHERE id BETWEEN 778 AND 849
  AND status <> 'lost';
