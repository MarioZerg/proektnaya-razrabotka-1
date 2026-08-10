-- Чиним вещь, зависшую после удаления из поставки FBS.
--
-- Товар 000694737 убрали из поставки OZON FBS, но отметка о наклеенном ярлыке
-- маркетплейса на нём осталась. Из-за этого вещь числилась «собранной», а по ярлыку
-- в поставку уже не сканировалась — кладовщик видел «отправление не найдено среди
-- собранных с полок» и не мог ни добавить её, ни вернуть в оборот.
--
-- Возвращаем вещь в обычный складской остаток: ярлык больше не действует, резерв снят.
-- Кладовщик заново соберёт её с полки и отстикерует, когда понадобится.
UPDATE goods_warehouse
SET status = 'in_stock',
    shipping_labeled_at = NULL,
    reserved_order_id = NULL,
    matched_at = NULL
WHERE id = 104
  AND NOT EXISTS (
    SELECT 1 FROM marketplace_supply_items msi WHERE msi.goods_warehouse_id = goods_warehouse.id
  );

-- Заказ, под который вещь резервировали, возвращаем в очередь: система подберёт
-- под него другую вещь со склада или отправит его в пошив.
UPDATE orders
SET fulfilled_from_stock_id = NULL,
    sewing_status = 'Новый'
WHERE fulfilled_from_stock_id = 104;
