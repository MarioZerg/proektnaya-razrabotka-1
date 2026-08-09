-- Проверочная поставка FBO с товарным составом: убеждаемся, что удалить нельзя,
-- если хотя бы одна вещь уже сшита, и что предупреждение считает заказы верно.
INSERT INTO t_p86119184_proektnaya_razrabotk.marketplace_supplies
    (marketplace, status, type, cluster, comment)
VALUES ('OZON', 'Открытая', 'FBO', 'ПРОВЕРКА-УДАЛЕНИЕ', 'Проверочная поставка, удалить');

-- Два заказа: один ещё не начали шить, второй уже готов. Из-за второго удаление
-- должно быть заблокировано.
INSERT INTO t_p86119184_proektnaya_razrabotk.orders
    (order_number, marketplace, order_type, status, product, quantity, source, sewing_status, supply_id)
SELECT 'CHK-DEL-1', 'OZON', 'FBO', 'Новый', 'Проверочный тюль', 1, 'manual', 'Новый', s.id
FROM t_p86119184_proektnaya_razrabotk.marketplace_supplies s
WHERE s.cluster = 'ПРОВЕРКА-УДАЛЕНИЕ';

INSERT INTO t_p86119184_proektnaya_razrabotk.orders
    (order_number, marketplace, order_type, status, product, quantity, source, sewing_status, supply_id)
SELECT 'CHK-DEL-2', 'OZON', 'FBO', 'Новый', 'Проверочный тюль 2', 1, 'manual', 'Готовые', s.id
FROM t_p86119184_proektnaya_razrabotk.marketplace_supplies s
WHERE s.cluster = 'ПРОВЕРКА-УДАЛЕНИЕ';
