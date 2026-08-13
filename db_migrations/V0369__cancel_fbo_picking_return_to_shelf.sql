-- Снимаем с подбора 22 FBO-заказа кластеров Воронеж и Новосибирск, вещи возвращаем на полку.
--
-- Эти заказы закрывались вещами со склада, но отгрузка по ним не состоялась: стикер
-- отправления ещё не наклеен, вещь физически лежит на своей полке. Заказы больше не нужны,
-- а вещи должны вернуться в свободный остаток и закрыть собой другие заказы.
--
-- Трогаем ТОЛЬКО безопасное подмножество:
--   * sewing_status = 'Со склада' — заказ закрыт вещью с полки, а не пошивом;
--   * shipping_labeled_at IS NULL — стикер отправления НЕ наклеен;
--   * shipped_at IS NULL — вещь никуда не уехала.
-- Застикерованные (8 шт.) и уже отгруженные (2 шт.) НЕ трогаем: по ним учёт совпадает
-- с реальностью, и рвать эту связь нельзя.
--
-- Физически строки не удаляем: удаление данных запрещено правилами платформы, а отмена
-- обратима. Для цеха результат тот же — отменённые заказы уходят из работы и счётчиков.

-- 1) Освобождаем вещи: статус «свободна на складе», привязка к заказу снимается.
--    Полку (shelf_id) НЕ трогаем — вещь физически никуда не переезжала, кладовщик
--    найдёт её там же, где она и лежит.
UPDATE goods_warehouse
SET status = 'in_stock',
    reserved_order_id = NULL,
    matched_at = NULL
WHERE shipping_labeled_at IS NULL
  AND shipped_at IS NULL
  AND id IN (
      SELECT o.fulfilled_from_stock_id FROM orders o
      WHERE o.order_type = 'FBO'
        AND o.sewing_status = 'Со склада'
        AND o.fulfilled_from_stock_id IS NOT NULL
        AND o.supply_id IN (
            SELECT id FROM marketplace_supplies WHERE cluster IN ('Воронеж', 'Новосибирск')
        )
  );

-- 2) Сами заказы выводим из работы и отвязываем от вещи со склада.
UPDATE orders o
SET status = 'Отменён',
    sewing_status = 'Отменён',
    cancelled_at = COALESCE(o.cancelled_at, now()),
    fulfilled_from_stock_id = NULL
WHERE o.order_type = 'FBO'
  AND o.sewing_status = 'Со склада'
  AND o.supply_id IN (
      SELECT id FROM marketplace_supplies WHERE cluster IN ('Воронеж', 'Новосибирск')
  )
  AND EXISTS (
      SELECT 1 FROM goods_warehouse g
      WHERE g.id = o.fulfilled_from_stock_id
        AND g.shipping_labeled_at IS NULL
        AND g.shipped_at IS NULL
  );
