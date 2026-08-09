-- Пометка «бракованный рулон» для отзыва рулона из цеха.
--
-- Закройщик встретил брак в начале рулона (больше 10 пог.м) — резать дальше нельзя.
-- Он помечает рулон бракованным прямо на терминале: рулон физически остаётся в цехе,
-- но в работу больше не идёт, а кладовщик получает задачу забрать его на склад.
--
-- Забирает кладовщик СКАНЕРОМ (как и остальной брак), а не простым подтверждением:
-- так видно, что рулон реально доехал до склада, а не остался лежать в цехе.
-- Может и отказать в заборе — тогда пометка снимается и рулон снова в работе.
ALTER TABLE t_p86119184_proektnaya_razrabotk.rolls
    ADD COLUMN IF NOT EXISTS defect_flagged_at TIMESTAMP;

ALTER TABLE t_p86119184_proektnaya_razrabotk.rolls
    ADD COLUMN IF NOT EXISTS defect_flagged_by INTEGER
        REFERENCES t_p86119184_proektnaya_razrabotk.users(id);

ALTER TABLE t_p86119184_proektnaya_razrabotk.rolls
    ADD COLUMN IF NOT EXISTS defect_flagged_by_name VARCHAR(255);

-- Что именно не так с рулоном — кладовщик и руководитель видят причину до забора.
ALTER TABLE t_p86119184_proektnaya_razrabotk.rolls
    ADD COLUMN IF NOT EXISTS defect_reason TEXT;

-- Кто и когда отказал в заборе: рулон вернулся в работу, причина отказа сохраняется.
ALTER TABLE t_p86119184_proektnaya_razrabotk.rolls
    ADD COLUMN IF NOT EXISTS defect_declined_at TIMESTAMP;

ALTER TABLE t_p86119184_proektnaya_razrabotk.rolls
    ADD COLUMN IF NOT EXISTS defect_declined_reason TEXT;

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.rolls.defect_flagged_at IS
    'Рулон помечен бракованным в цехе: в работу не идёт, ждёт забора кладовщиком';

CREATE INDEX IF NOT EXISTS idx_rolls_defect_flagged
    ON t_p86119184_proektnaya_razrabotk.rolls (defect_flagged_at)
    WHERE defect_flagged_at IS NOT NULL;
