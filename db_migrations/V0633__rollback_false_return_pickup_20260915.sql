-- ОТКАТ ЛОЖНОЙ ПРИЁМКИ ВОЗВРАТОВ ОТ 15.09.2026.
--
-- Что случилось. Кладовщик привёз с ПВЗ реальную выдачу, открыл экран «ход
-- приёмки», и система опросила OZON. Площадка ответила «сотрудник ПВЗ
-- отсканировал все коробки», после чего код пометил забранными 44 заявки —
-- одним запросом, в одну миллисекунду (10:58:54.557011), без участия человека:
-- поле picked_up_by у всех осталось пустым.
--
-- Беда в том, что выбирались НЕ ТЕ заявки. Логика брала N самых старых записей
-- со статусом «В пункте выдачи», а не те вещи, что реально выдали. В очереди
-- ПВЗ лежат заявки с 25 августа, они и попали в приёмку. Кладовщик отсканировал
-- 8 настоящих пакетов, а 36 «не пикались» — их физически нет, и размеры в
-- списке не совпадали с тем, что он держал в руках.
--
-- Отдельный урон: под эти 36 заявок система не создала новые карточки, а взяла
-- УЖЕ ОТГРУЖЕННЫЕ вещи со склада и вернула их в статус «требует разбора» —
-- обнулила полку, дату отгрузки и признак наклеенного ярлыка. То есть 32 вещи,
-- которые давно уехали к покупателям (26 из них в закрытых поставках), снова
-- числились у нас в наличии.
--
-- Возвращаем как было: заявки — в очередь ПВЗ, вещи — в отгруженные.
-- received_at у вещи не трогаем: поле обязательное, и это дата первой приёмки
-- на склад, а не сегодняшней ложной операции.

-- 1. Вещи, уехавшие в поставках, возвращаем в статус «отгружена».
--    Дату отгрузки берём из поставки, куда вещь реально попала.
UPDATE goods_warehouse g
SET status = 'shipped',
    receive_reason = NULL,
    shipped_at = COALESCE(
        (SELECT ms.ship_to_marketplace_at
           FROM marketplace_supply_items msi
           JOIN marketplace_supplies ms ON ms.id = msi.supply_id
          WHERE msi.goods_warehouse_id = g.id
          ORDER BY msi.id DESC LIMIT 1),
        (SELECT ms.completed_at
           FROM marketplace_supply_items msi
           JOIN marketplace_supplies ms ON ms.id = msi.supply_id
          WHERE msi.goods_warehouse_id = g.id
          ORDER BY msi.id DESC LIMIT 1),
        now()
    )
FROM marketplace_returns r, orders o
WHERE g.id = r.goods_warehouse_id
  AND o.id = g.order_id
  AND r.picked_up_at = '2026-09-15 10:58:54.557011'
  AND r.status = 'picked_up'
  AND o.status = 'Отгружен';

-- 2. Остальные (заказ «Выполнен» или «Готов», в поставку не попали) — вещи,
--    которые лежали на складе готовыми. Возвращаем в наличие без полки:
--    куда именно они положены, система не знала и до ложной приёмки.
UPDATE goods_warehouse g
SET status = 'in_stock',
    receive_reason = NULL
FROM marketplace_returns r, orders o
WHERE g.id = r.goods_warehouse_id
  AND o.id = g.order_id
  AND r.picked_up_at = '2026-09-15 10:58:54.557011'
  AND r.status = 'picked_up'
  AND o.status <> 'Отгружен';

-- 3. Заявки возвращаем в очередь пункта выдачи: они там и лежат физически.
--    Связь с вещью и отметки приёмки снимаем — приёмки не было.
UPDATE marketplace_returns
SET status = 'new',
    picked_up_at = NULL,
    picked_up_by = NULL,
    giveout_id = NULL,
    goods_warehouse_id = NULL,
    received_at = NULL
WHERE picked_up_at = '2026-09-15 10:58:54.557011'
  AND status = 'picked_up';
