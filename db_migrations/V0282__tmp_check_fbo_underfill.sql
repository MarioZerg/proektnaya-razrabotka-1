-- Проверочная поставка FBO: убеждаемся, что недособранную нельзя отправить в отгрузку.
-- План 10 шт., собрано 0 — система должна отказать. Запись временная.
INSERT INTO t_p86119184_proektnaya_razrabotk.marketplace_supplies
    (marketplace, status, type, cluster, total_quantity_marketplace, comment)
VALUES ('OZON', 'На сборке', 'FBO', 'ПРОВЕРКА', 10, 'Проверочная поставка, удалить');
