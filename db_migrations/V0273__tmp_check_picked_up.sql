-- Проверочный возврат в статусе «забран, ждёт разбора»: убеждаемся, что он виден
-- в счётчиках и фильтрах, и что кладовщик может его разобрать. Временная запись.
INSERT INTO t_p86119184_proektnaya_razrabotk.marketplace_returns
    (marketplace, external_id, status, approved_at, mp_created_at, picked_up_at,
     product_name, return_barcode)
VALUES
    ('OZON', 'CHECK-PICKUP-1', 'picked_up', now(), now(), now(),
     'Проверочный тюль', 'CHECK-PICKUP-BC-1')
ON CONFLICT DO NOTHING;
