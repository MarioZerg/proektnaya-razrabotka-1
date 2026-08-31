-- Заводим складскую запись заказу, который её потерял при обрыве закрытия.
--
-- У заказа 55691968-0274-5 (id 91076) закрытие оборвалось на создании складской
-- записи — из-за столкновения складских кодов (см. V0552). Статус «Готовые»
-- проставлен, упаковка списана, вещь физически лежит в контейнере — а записи о
-- ней на складе нет. Из-за этого её НЕЛЬЗЯ отсканировать в поставку: сканирование
-- падает с «не найдено среди собранных».
--
-- Заводим запись так же, как это делает терминал для обычного FBS-заказа:
-- статус awaiting_supply («ждёт поставки», не на полке), причина fbs_ready,
-- отметка о наклеенном ярлыке маркетплейса.
--
-- Код берём из счётчика — того самого, который теперь исключает столкновения.
--
-- Условия намеренно узкие: только заказ, который РЕАЛЬНО поедет покупателю.
-- Отменённые, уже доставленные, отгруженные и служебные карточки (WH-…) не
-- трогаем — им складская запись не нужна и создавать её задним числом вредно.
INSERT INTO goods_warehouse (order_id, status, storage_barcode,
                             receive_reason, shipping_labeled_at)
SELECT o.id,
       'awaiting_supply',
       'GW-' || lpad(nextval('goods_warehouse_storage_seq')::text, 6, '0'),
       'fbs_ready',
       COALESCE(o.packed_at, now())
  FROM orders o
 WHERE o.sewing_status = 'Готовые'
   AND o.order_type = 'FBS'
   AND o.packed_at IS NOT NULL
   AND COALESCE(o.ozon_status, '') NOT IN ('cancelled', 'delivered', 'delivering')
   AND COALESCE(o.status, '') <> 'Отгружен'
   AND o.order_number NOT LIKE 'WH-%'
   AND NOT EXISTS (SELECT 1 FROM goods_warehouse g WHERE g.order_id = o.id);
