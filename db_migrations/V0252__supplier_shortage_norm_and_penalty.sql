-- Норма недостачи у поставщика и штрафы за её превышение.
--
-- Недостача — это метраж, которого не оказалось в рулоне: намотано меньше, чем заявлено.
-- Зависит от поставщика, а не от вида ткани: один мотает честно, другой недокладывает.
-- Поэтому норма живёт у поставщика, а не у материала.
ALTER TABLE t_p86119184_proektnaya_razrabotk.suppliers
    ADD COLUMN IF NOT EXISTS shortage_norm_percent NUMERIC(6,3);

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.suppliers.shortage_norm_percent IS
    'Допустимая недостача в % от рулона. NULL — норма не задана, штрафы не начисляются';

-- Норма, действовавшая на момент приёмки рулона. Фиксируем на рулоне: если поставщику
-- потом поменяют норму, уже закрытые рулоны не должны пересчитываться задним числом.
ALTER TABLE t_p86119184_proektnaya_razrabotk.rolls
    ADD COLUMN IF NOT EXISTS shortage_norm_percent NUMERIC(6,3);

-- Итоговая сумма штрафа по рулону — чтобы не пересчитывать её каждый раз и видеть,
-- что по этому рулону удержание уже проведено.
ALTER TABLE t_p86119184_proektnaya_razrabotk.rolls
    ADD COLUMN IF NOT EXISTS penalty_total NUMERIC(12,2);

-- Привязка штрафа к рулону: по какому рулону начислено удержание сотруднику.
ALTER TABLE t_p86119184_proektnaya_razrabotk.salary_accruals
    ADD COLUMN IF NOT EXISTS roll_id INTEGER REFERENCES t_p86119184_proektnaya_razrabotk.rolls(id);

CREATE INDEX IF NOT EXISTS idx_salary_accruals_roll
    ON t_p86119184_proektnaya_razrabotk.salary_accruals(roll_id);
