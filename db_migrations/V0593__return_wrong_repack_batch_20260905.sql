-- Возврат вещей, ошибочно отправленных в цех на перепаковку 05.09.2026.
--
-- ЧТО СЛУЧИЛОСЬ. Кладовщик Егор Мальцев утром 05.09 передал упаковщицам
-- 30 возвратов (в журнале: 09:31 — 28 шт. и два по одной). Отправка была
-- ошибочной: эти вещи должны были уехать в другое место.
--
-- ПОЧЕМУ ВОЗВРАТ БЕЗОПАСЕН. Ни одну из них цех не взял в работу:
-- repack_workshop_id пуст у всех 30, inspected_at тоже — упаковщица к ним
-- не прикасалась. Значит, откатывать нечего: ни оплаты, ни осмотра, ни
-- решения по браку по ним не проходило.
--
-- КУДА ВОЗВРАЩАЕМ. В статус 'mp_return' — «приехал с ПВЗ, лежит у
-- кладовщика, решение не принято». Это ровно то состояние, из которого их
-- и отправили, поэтому кладовщик снова увидит их у себя в разборе
-- возвратов и переместит куда нужно.
--
-- Заявку на возврат тоже открываем обратно: 'picked_up' + outcome = NULL,
-- иначе вещь висела бы «разобранной» и в списке на разбор не появилась.
UPDATE marketplace_returns
SET status = 'picked_up', outcome = NULL, outcome_at = NULL, outcome_by = NULL
WHERE goods_warehouse_id IN (
    SELECT id FROM goods_warehouse
    WHERE status = 'repacking'
      AND received_at >= '2026-09-05'
      AND repack_workshop_id IS NULL
      AND inspected_at IS NULL
)
  AND status = 'processed' AND outcome = 'repack';

UPDATE goods_warehouse
SET status = 'mp_return',
    repack_return_id = NULL,
    repack_workshop_id = NULL
WHERE status = 'repacking'
  AND received_at >= '2026-09-05'
  AND repack_workshop_id IS NULL
  AND inspected_at IS NULL;

-- След в истории: почему вещи вернулись из цеха. Без записи кладовщик
-- увидел бы их снова у себя и не понял, что произошло.
INSERT INTO audit_log (category, user_id, user_name, action, entity_type, entity_id, description)
SELECT 'warehouse', NULL, 'Система', 'return_from_repack', 'goods_warehouse', gw.id,
       'Возвращена кладовщику: отправлена в цех на перепаковку по ошибке'
FROM goods_warehouse gw
WHERE gw.status = 'mp_return'
  AND gw.received_at >= '2026-09-05';
