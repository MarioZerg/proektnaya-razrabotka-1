-- УБИРАЕМ ТЕСТОВЫЕ ДАННЫЕ С БОЕВЫХ ЭКРАНОВ.
--
-- Удалять записи нельзя (и не нужно: история проверки пусть останется), поэтому
-- переводим тестовые заказы и рулоны в состояние, в котором они никому не мешают:
--
--   * заказы  -> «Отменён» + статус пошива «Готовые»: не попадут ни в очередь
--                закройщика, ни в подбор, ни в поставки, ни в зарплату;
--   * рулоны  -> 'completed' с нулевым остатком: не появятся в списке рулонов
--                цеха и не попадут в FIFO при раскрое.
--
-- Тестовый цех (QA) остаётся: он пуст и пригодится для следующих проверок.

UPDATE orders
SET status = 'Отменён',
    sewing_status = 'Готовые',
    workshop_id = (SELECT id FROM workshops WHERE name = 'Тестовый цех (QA)')
WHERE order_number LIKE 'QA-TEST-%';

UPDATE rolls
SET remaining_quantity = 0,
    packer_returned_quantity = 0,
    status = 'completed',
    completed_at = COALESCE(completed_at, now())
WHERE barcode LIKE 'QA-TEST-%';
