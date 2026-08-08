-- Разделяем план и факт отгрузки в газельку.
--
-- Раньше поле ship_to_gazelka_at служило и планом, и фактом: при подтверждении отгрузки
-- в него писали текущее время, и напоминание продолжало срабатывать — система не могла
-- отличить «запланировано на вчера» от «вчера реально уехало».
--
-- Теперь план остаётся в ship_to_gazelka_at, а факт пишется отдельно. Напоминание
-- показывается, только когда плановое время прошло, а факта нет.
ALTER TABLE t_p86119184_proektnaya_razrabotk.marketplace_supplies
    ADD COLUMN IF NOT EXISTS gazelka_shipped_at TIMESTAMP;

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.marketplace_supplies.gazelka_shipped_at IS
    'Факт: когда кладовщик подтвердил, что поставка уехала в газельку. NULL — ещё на складе';
