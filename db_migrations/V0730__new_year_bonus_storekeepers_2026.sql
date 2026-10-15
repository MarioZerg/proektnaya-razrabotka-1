-- Новогодняя премия кладовщикам: разовое начисление 25.12.2026.
-- Деньги падают на баланс зарплаты в этот день (one_time_awards).
-- 25 декабря попадает в период «с 20-го по конец месяца», его выплачивают 10 января.
-- Повторно начислить нельзя: уникальный ключ (user_id, award_key) и paid_at.
-- Имена в базе записаны и как «Фамилия Имя», и как «Имя Фамилия» — ищем оба варианта.

INSERT INTO one_time_awards (user_id, award_key, title, amount, pay_on, highlights)
SELECT u.id,
       'new_year_2026',
       'Новогодняя премия',
       15000,
       DATE '2026-12-25',
       '[
         "Начисление автоматическое — 25.12.2026",
         "Сумма 15 000 ₽",
         "Выплата 10.01.2027 — вместе с зарплатой за 20–31 декабря"
       ]'::jsonb
FROM users u
WHERE u.is_active = true
  AND u.role IN ('storekeeper', 'senior_storekeeper')
  AND (
    u.full_name ILIKE 'Коротков Кирилл%'
    OR u.full_name ILIKE 'Кирилл Коротков%'
    OR u.full_name ILIKE 'Мальцев Егор%'
    OR u.full_name ILIKE 'Егор Мальцев%'
  )
ON CONFLICT (user_id, award_key) DO UPDATE
SET amount = EXCLUDED.amount,
    pay_on = EXCLUDED.pay_on,
    title = EXCLUDED.title,
    highlights = EXCLUDED.highlights
WHERE one_time_awards.paid_at IS NULL;