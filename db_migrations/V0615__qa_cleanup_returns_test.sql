-- УБОРКА ПОСЛЕ ПРОВЕРКИ ВОЗВРАТОВ И ПЕРЕПАКОВКИ.
--
-- Возвращаем всё в состояние, в котором тестовые записи никому не мешают.
-- Удалять нельзя (и не нужно — история проверки пусть останется), поэтому
-- переводим в безопасные конечные состояния:
--
--   * тестовые вещи      -> 'disposed': не попадут ни в подбор, ни в остатки,
--                           ни в очередь перепаковки, ни в счётчики кладовщика;
--   * тестовые возвраты  -> закрыты с пометкой QA;
--   * тестовые рулоны    -> 'completed' с нулём: не попадут в FIFO при раскрое
--                           и не покажутся в списке рулонов цеха;
--   * начисления QA      -> обнуляем, чтобы не попали в зарплату.
--
-- Боевых данных не касаемся: все условия отбирают строго записи с префиксом QA.

UPDATE goods_warehouse
SET status = 'disposed',
    disposed_at = COALESCE(disposed_at, now()),
    dispose_reason = COALESCE(dispose_reason, 'Тестовая проверка QA — данные не боевые'),
    repack_workshop_id = NULL,
    repack_return_id = NULL,
    reserved_order_id = NULL,
    matched_at = NULL,
    shelf_id = NULL
WHERE storage_barcode LIKE 'QA-GW-%';

UPDATE marketplace_returns
SET outcome = COALESCE(outcome, 'utilized'),
    outcome_at = COALESCE(outcome_at, now()),
    damage_note = COALESCE(damage_note, 'Тестовая проверка QA')
WHERE external_id LIKE 'QA-RET-%';

UPDATE rolls
SET remaining_quantity = 0,
    packer_returned_quantity = 0,
    status = 'completed',
    completed_at = COALESCE(completed_at, now())
WHERE barcode LIKE 'QA-TEST-%';

UPDATE salary_accruals SET amount = 0
WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'QA-TEST-%');
