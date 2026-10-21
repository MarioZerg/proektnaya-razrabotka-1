INSERT INTO salary_accruals (user_id, type, amount, accrued_for, description)
SELECT 51, 'packer_returns_shift', 1850, d::date,
       'Оклад за смену (терминал не работал — смену открыть не удалось)'
FROM generate_series(date '2026-10-07', date '2026-10-20', interval '1 day') d
WHERE EXTRACT(ISODOW FROM d) < 6
  AND NOT EXISTS (
    SELECT 1 FROM salary_accruals a
    WHERE a.user_id = 51 AND a.type = 'packer_returns_shift' AND a.accrued_for = d::date)
ON CONFLICT DO NOTHING;

INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description)
VALUES (NULL, 'Администратор (через разработчика)', 'salary', 'accrue_shift_salary_backfill', 'user', 51,
        'Ирине доначислен оклад 1850 ₽ за будни 07–20.10.2026 без открытой смены (не работал терминал)');