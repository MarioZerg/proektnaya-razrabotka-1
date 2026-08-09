-- Проверочный возврат: убеждаемся, что при указании полки вещь сразу ложится на неё
-- (статус in_stock), а без полки — встаёт в очередь на укладку. Запись временная.
INSERT INTO t_p86119184_proektnaya_razrabotk.marketplace_returns
    (marketplace, external_id, status, approved_at, mp_created_at, product_name, return_barcode)
VALUES
    ('OZON', 'CHECK-SHELF-1', 'approved', now(), now(), 'Тюль проверочный', 'CHECK-SHELF-BC-1'),
    ('OZON', 'CHECK-SHELF-2', 'approved', now(), now(), 'Штора проверочная', 'CHECK-SHELF-BC-2')
ON CONFLICT DO NOTHING;
