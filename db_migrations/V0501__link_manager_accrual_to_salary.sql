-- Выплата вознаграждения менеджера по конкретному отчёту.
--
-- Раньше начисления менеджера жили отдельно от зарплаты: их было видно, но
-- выплатить одним действием нельзя — приходилось заводить ручное начисление
-- и сверять суммы глазами.
--
-- Теперь у начисления есть ссылка на запись зарплаты. Нажатие «Выплатить»
-- создаёт обычное начисление в зарплате, и дальше вознаграждение проходит
-- через кассу тем же путём, что и оплата труда цеха.
ALTER TABLE manager_accruals
    ADD COLUMN IF NOT EXISTS salary_accrual_id INTEGER,
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;

COMMENT ON COLUMN manager_accruals.salary_accrual_id IS
    'Начисление в зарплате, созданное при выплате по этому отчёту';
COMMENT ON COLUMN manager_accruals.paid_at IS
    'Когда вознаграждение по отчёту передано в зарплату';

CREATE INDEX IF NOT EXISTS idx_manager_accruals_paid
    ON manager_accruals(user_id, paid_at);
