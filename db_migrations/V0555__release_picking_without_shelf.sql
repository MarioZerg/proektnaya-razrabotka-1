-- Снимаем подбор с вещей, которые НЕ ЛЕЖАТ НА ПОЛКЕ.
--
-- ПРАВИЛО: вещь становится складским остатком только после того, как кладовщик
-- принял её на конкретную полку по стикеру хранения. До этого она физически в
-- цехе (или в разборе возвратов) — закрывать ею новые заказы нельзя.
--
-- ЧТО БЫЛО. Подбор брал любую вещь в статусе «в наличии», даже без полки.
-- Система закрывала ею новый заказ, кладовщик шёл к стеллажу — а вещи там нет.
-- Заказ числился собранным со склада, ярлык печатать не с чего, отправление
-- зависало, и в цех оно уже не возвращалось.
--
-- Причина закрыта в коде: подбор теперь требует заполненную полку.
-- Здесь разбираем то, что успело подобраться по старому правилу.
--
-- Заказы возвращаем в производство (статус «Новый»), вещам снимаем резерв.
-- Это обратимо: как только кладовщик разложит вещи по полкам, подбор случится
-- сам и заказ снова закроется складом — но уже вещью, которая реально там есть.

-- 1. Заказы, закрытые вещью без полки, — обратно в производство.
UPDATE orders o
   SET sewing_status = 'Новый',
       fulfilled_from_stock_id = NULL
  FROM goods_warehouse g
 WHERE g.id = o.fulfilled_from_stock_id
   AND g.shelf_id IS NULL
   AND o.sewing_status = 'Со склада'
   -- Цех к заказу не приступал: никто не назначен, крой не сделан.
   AND o.assigned_user_id IS NULL
   AND o.cut_at IS NULL
   AND o.taken_at IS NULL
   -- Заказ ещё нужен маркетплейсу: отменённые и уехавшие не трогаем.
   AND COALESCE(o.status, '') <> 'Отменён'
   AND COALESCE(o.ozon_status, '') NOT IN
       ('cancelled', 'delivering', 'delivered', 'not_accepted', 'driver_pickup')
   -- Ярлык ещё не печатали — вещь никуда не собрана.
   AND g.shipping_labeled_at IS NULL
   -- Вещь не уехала в коробе поставки.
   AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi
                     JOIN marketplace_supplies ms ON ms.id = msi.supply_id
                    WHERE msi.goods_warehouse_id = g.id
                      AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена'));

-- 2. Снимаем резерв с самих вещей и возвращаем их в «в наличии»:
--    вещь годная, просто кладовщик ещё не принял её на полку.
UPDATE goods_warehouse g
   SET reserved_order_id = NULL,
       matched_at = NULL,
       status = 'in_stock'
 WHERE g.shelf_id IS NULL
   AND g.reserved_order_id IS NOT NULL
   AND g.status IN ('picking', 'reserved', 'in_stock')
   AND g.shipping_labeled_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM orders o
                    WHERE o.id = g.reserved_order_id
                      AND o.sewing_status = 'Со склада')
   AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi
                     JOIN marketplace_supplies ms ON ms.id = msi.supply_id
                    WHERE msi.goods_warehouse_id = g.id
                      AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена'));
