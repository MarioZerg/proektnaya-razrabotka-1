-- Гасим 50 задвоенных заказов OZON, появившихся из-за смены формата номера.
-- Причина: вещи одного отправления раньше нумеровались с артикулом
-- («...-vyal3_265-1»), после смены формата та же вещь загрузилась заново
-- под номером «...-1» — защита от дублей (ON CONFLICT по order_number)
-- не сработала, т.к. номер стал другим.
-- Данные не стираем: помечаем статусом «Отменён» — в системе такие заказы
-- показываются зачёркнутыми, в очередь раскроя и отгрузки не попадают.
-- Трогаем ТОЛЬКО безопасные: «Новый», никому не назначены, не закрыты со склада,
-- и у того же отправления есть исходная вещь со старым номером.
UPDATE orders o
SET status = 'Отменён'
WHERE o.marketplace = 'OZON'
  AND o.sewing_status = 'Новый'
  AND o.order_number LIKE '%-1'
  AND o.order_number NOT LIKE '%\_%'
  AND o.ozon_posting_number IS NOT NULL
  AND o.assigned_user_id IS NULL
  AND o.fulfilled_from_stock_id IS NULL
  AND COALESCE(o.status, '') <> 'Отменён'
  AND EXISTS (
    SELECT 1 FROM orders x
    WHERE x.ozon_posting_number = o.ozon_posting_number
      AND x.order_number LIKE '%\_%');