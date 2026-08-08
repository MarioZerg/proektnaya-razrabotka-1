-- Проверочные возвраты в статусе «одобрен»: смотрим, как считается счётчик ожидающих
-- на ПВЗ по каждой площадке. Записи временные, потом переведём в обработанные.
INSERT INTO t_p86119184_proektnaya_razrabotk.marketplace_returns
    (marketplace, external_id, status, approved_at, mp_created_at)
VALUES
    ('WB', 'CHECK-WB-1', 'approved', now(), now()),
    ('WB', 'CHECK-WB-2', 'approved', now(), now()),
    ('OZON', 'CHECK-OZ-1', 'approved', now(), now())
ON CONFLICT DO NOTHING;
