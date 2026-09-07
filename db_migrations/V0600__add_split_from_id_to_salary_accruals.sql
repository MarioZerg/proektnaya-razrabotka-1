-- Связь между частями разделённого долга.
--
-- Когда штраф больше заработка, он гасится частично: исходная запись
-- уменьшается до погашенной суммы, а на непогашенный остаток заводится новая
-- запись. Без связи между ними отмена выплаты вернула бы исходный штраф в
-- полном объёме, а запись-остаток осталась бы висеть — долг задвоился бы.
--
-- Здесь храним ссылку на «родителя»: при отмене выплаты остаток схлопывается
-- обратно в исходную запись, и сумма долга сходится.
ALTER TABLE salary_accruals
  ADD COLUMN IF NOT EXISTS split_from_id INTEGER NULL REFERENCES salary_accruals(id);

CREATE INDEX IF NOT EXISTS idx_salary_accruals_split_from
  ON salary_accruals(split_from_id) WHERE split_from_id IS NOT NULL;
