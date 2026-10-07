CREATE UNIQUE INDEX IF NOT EXISTS uq_onec_outbox_salary_accrual
  ON onec_outbox (entity, entity_id)
  WHERE entity = 'salary_accrual';