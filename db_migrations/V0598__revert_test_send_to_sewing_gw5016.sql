-- Откат тестового вызова send_to_sewing по вещи GW-005016.
--
-- ЧТО ПРОИЗОШЛО. При проверке новых защит я вызвал «отправить в пошив» на
-- вещи, подобранной под заказ (этот сценарий и должен работать) — вещь
-- списалась, а заказ 0124203208-0385-1 ушёл в цех шиться заново. Пометка в
-- причине: «ПРОВЕРКА-НЕ-ПРИМЕНЯТЬ». Реального брака не было, вещь физически
-- лежит на полке 17.
--
-- ВОЗВРАЩАЕМ ВСЁ КАК БЫЛО: вещь на полку в подбор под свой заказ, заказ —
-- обратно в закрытие складом.
UPDATE goods_warehouse
SET status = 'picking',
    lost_reason = NULL,
    lost_at = NULL,
    reserved_order_id = 94270,
    matched_at = now()
WHERE id = 5016
  AND lost_reason LIKE '%ПРОВЕРКА-НЕ-ПРИМЕНЯТЬ%';

-- Заказ снова закрывается этой вещью со склада, а не пошивом.
UPDATE orders
SET sewing_status = 'Со склада',
    fulfilled_from_stock_id = 5016
WHERE id = 94270
  AND sewing_status = 'Новый';

INSERT INTO audit_log (category, user_id, user_name, action, entity_type, entity_id, description)
VALUES ('warehouse', NULL, 'Система', 'restore_lost', 'goods_warehouse', 5016,
        'Откат тестовой отправки в пошив: вещь возвращена в подбор, '
        'заказ 0124203208-0385-1 снова закрывается складом');
