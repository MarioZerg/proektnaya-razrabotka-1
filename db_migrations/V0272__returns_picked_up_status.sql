-- Статус «забран с ПВЗ, но ещё не разобран».
--
-- Раньше возврат прыгал сразу из «едет к нам» в «обработан», хотя между этими
-- моментами есть целый этап: кладовщик физически забрал коробки с пункта выдачи,
-- привёз на склад, но ещё не осмотрел вещи и не решил — на полку, в перепаковку
-- или в утиль. Без отдельного статуса такие возвраты «висели в воздухе»: по бумагам
-- едут, фактически лежат на складе неразобранные.
--
-- Теперь путь такой: new -> approved -> picked_up -> processed.
ALTER TABLE t_p86119184_proektnaya_razrabotk.marketplace_returns
    ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP;

ALTER TABLE t_p86119184_proektnaya_razrabotk.marketplace_returns
    ADD COLUMN IF NOT EXISTS picked_up_by INTEGER
        REFERENCES t_p86119184_proektnaya_razrabotk.users(id);

-- Идентификатор отправления OZON, которым возврат приехал: по нему отмечаем забор
-- автоматически, когда сотрудник ПВЗ отсканировал коробку.
ALTER TABLE t_p86119184_proektnaya_razrabotk.marketplace_returns
    ADD COLUMN IF NOT EXISTS giveout_id BIGINT;

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.marketplace_returns.picked_up_at IS
    'Когда возврат физически забрали с пункта выдачи (до осмотра на складе)';

CREATE INDEX IF NOT EXISTS idx_marketplace_returns_giveout
    ON t_p86119184_proektnaya_razrabotk.marketplace_returns (giveout_id);
