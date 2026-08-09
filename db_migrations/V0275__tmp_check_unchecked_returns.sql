-- Проверочные возвраты в статусе «забран, ждёт разбора»: смотрим, как выглядит блок
-- непроверенных на складе и плитка на дашборде. Записи временные.
INSERT INTO t_p86119184_proektnaya_razrabotk.marketplace_returns
    (marketplace, external_id, status, approved_at, mp_created_at, picked_up_at, product_name)
VALUES
    ('OZON', 'CHECK-UNCHK-1', 'picked_up', now(), now(), now(), 'Тюль Вуаль 200x240'),
    ('OZON', 'CHECK-UNCHK-2', 'picked_up', now(), now(), now(), 'Штора блэкаут 200x260'),
    ('WB',   'CHECK-UNCHK-3', 'picked_up', now(), now(), now(), 'Тюль Сетка 300x270')
ON CONFLICT DO NOTHING;
