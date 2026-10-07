-- Триггеры в этой БД создавать нельзя, очередь 1С пишет код функций.
-- Отметка: начисления с id <= этой границы — история, в 1С их не шлём.
INSERT INTO onec_outbox (entity, entity_id, payload, status)
SELECT 'salary_accrual', COALESCE(MAX(id), 0), '{"baseline": true}'::jsonb, 'baseline'
FROM salary_accruals
WHERE NOT EXISTS (SELECT 1 FROM onec_outbox WHERE entity = 'salary_accrual' AND status = 'baseline');