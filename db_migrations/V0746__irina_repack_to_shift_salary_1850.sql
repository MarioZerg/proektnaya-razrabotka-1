INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description, details)
SELECT NULL, 'Администратор (через разработчика)', 'salary', 'cancel_repack_accruals', 'user', 51,
       'Обнулены начисления за перепаковку у Ирины: ' || count(*) || ' шт на ' || sum(amount) || ' ₽ — переведена на оклад 1850 ₽ за смену с 07.10.2026',
       jsonb_build_object('count', count(*), 'sum', sum(amount))
FROM salary_accruals WHERE user_id = 51 AND type = 'packer_repack' AND paid_at IS NULL AND amount <> 0;

UPDATE salary_accruals
SET amount = 0,
    description = LEFT(COALESCE(description, '') || ' — отменено: оплата окладом за смену', 500)
WHERE user_id = 51 AND type = 'packer_repack' AND paid_at IS NULL AND amount <> 0;

UPDATE salary_rates SET rate = 0 WHERE role = 'packer_repack' AND workshop_id = 1;

INSERT INTO salary_rates (role, material_id, width, rate, workshop_id)
SELECT 'packer_returns', NULL, NULL, 1850, 1
WHERE NOT EXISTS (SELECT 1 FROM salary_rates WHERE role = 'packer_returns' AND workshop_id = 1 AND material_id IS NULL AND width IS NULL);
UPDATE salary_rates SET rate = 1850 WHERE role = 'packer_returns' AND workshop_id = 1 AND material_id IS NULL AND width IS NULL;

INSERT INTO salary_accruals (user_id, type, amount, shift_session_id, accrued_for, description)
SELECT 51, 'packer_returns_shift', 1850, ss.id, (ss.opened_at + interval '3 hours')::date, 'Оклад за смену'
FROM shift_sessions ss
WHERE ss.user_id = 51 AND ss.closed_at IS NOT NULL
  AND ss.opened_at >= timestamp '2026-10-06 21:00'
  AND NOT EXISTS (
    SELECT 1 FROM salary_accruals a WHERE a.user_id = 51 AND a.type = 'packer_returns_shift'
      AND a.accrued_for = (ss.opened_at + interval '3 hours')::date)
ON CONFLICT DO NOTHING;

INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description)
SELECT NULL, 'Администратор (через разработчика)', 'salary', 'accrue_shift_salary_backfill', 'user', 51,
       'Ирине начислен оклад 1850 ₽ за смены с 07.10.2026: ' || count(*) || ' смен на ' || sum(amount) || ' ₽'
FROM salary_accruals WHERE user_id = 51 AND type = 'packer_returns_shift';