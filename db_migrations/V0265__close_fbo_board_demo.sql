-- Убираем проверочные поставки со сводки: помечаем выполненными, чтобы они не висели
-- на дашборде. Удалять записи нельзя, а в сводку попадают только незавершённые.
UPDATE t_p86119184_proektnaya_razrabotk.marketplace_supplies
SET status = 'Выполнена',
    completed_at = now(),
    comment = 'Проверка сводки отгрузок при настройке'
WHERE supply_number LIKE 'ПРОВЕРКА-%';
