CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_accruals_daily_packer_returns
ON salary_accruals (user_id, type, accrued_for)
WHERE type = 'packer_returns_shift';