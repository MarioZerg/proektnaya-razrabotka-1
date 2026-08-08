-- Проверочная поставка FBO: смотрим, как выглядит сводка на дашборде и срабатывает ли
-- напоминание кладовщику. Дата отгрузки во вчера — значит система должна спросить,
-- уехала ли поставка в газельку.
INSERT INTO t_p86119184_proektnaya_razrabotk.marketplace_supplies
    (marketplace, type, status, supply_number, cluster, ship_to_gazelka_at,
     gazelka_pickup, supply_date, timeslot)
VALUES
    ('OZON', 'FBO', 'На сборке', 'ПРОВЕРКА-001', 'Москва (Хоругвино)',
     now() - interval '1 day', true, CURRENT_DATE + 1, '10:00-12:00'),
    ('WB', 'FBO', 'Отгрузка', 'ПРОВЕРКА-002', 'Казань',
     now() + interval '2 day', false, CURRENT_DATE + 3, '14:00-16:00');
