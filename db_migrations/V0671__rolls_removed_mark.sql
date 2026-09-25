-- Пометка рулона как убранного из работы (администратором).
--
-- Рулон убирают, когда его завели ошибочно: дубль при разгрузке, опечатка в
-- штрихкоде, приёмка оформлена дважды. Но строка приёмки — первичный документ:
-- по ней считается объём поставки, себестоимость метра и расчёты с поставщиком.
-- Вычеркнуть её молча значит переписать историю задним числом.
--
-- Поэтому рулон убирается из работы (склад его больше не видит), а в приёмке
-- строка остаётся и подписывается как убранная: видно, что позиция была, кто
-- и когда её убрал.

ALTER TABLE t_p86119184_proektnaya_razrabotk.rolls
    ADD COLUMN IF NOT EXISTS removed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS removed_by INTEGER
        REFERENCES t_p86119184_proektnaya_razrabotk.users(id),
    ADD COLUMN IF NOT EXISTS removed_by_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS removed_reason TEXT;

-- Списки склада и цеха фильтруют по этому полю — индекс на действующих рулонах.
CREATE INDEX IF NOT EXISTS idx_rolls_alive
    ON t_p86119184_proektnaya_razrabotk.rolls (status)
    WHERE removed_at IS NULL;
