-- Обновление статистики планировщика по горячим таблицам.
--
-- ЗАЧЕМ. PostgreSQL решает, идти ли по индексу или перебирать таблицу целиком,
-- опираясь на статистику о данных. Если статистика устарела, планировщик
-- ошибается и выбирает полный перебор даже там, где индекс есть.
--
-- Именно это и происходило: по marketplace_item_materials и
-- marketplace_supply_items базa прочитала 15 и 10 МИЛЛИАРДОВ строк подряд,
-- хотя нужные индексы на этих таблицах давно созданы. Такой холостой перебор
-- съедает ресурсы сервера, из-за чего тормозили ВСЕ функции разом — и «взять
-- заказ» у швей в том числе.
--
-- ANALYZE только пересчитывает статистику: данные не меняются, таблицы не
-- блокируются, работа цеха не прерывается.
ANALYZE marketplace_item_materials;
ANALYZE marketplace_supply_items;
ANALYZE orders;
ANALYZE goods_warehouse;
ANALYZE rolls;
ANALYZE materials;
ANALYZE marketplace_items;
ANALYZE marketplace_returns;
ANALYZE salary_accruals;
ANALYZE shift_sessions;
ANALYZE order_material_usage;
ANALYZE audit_log;
