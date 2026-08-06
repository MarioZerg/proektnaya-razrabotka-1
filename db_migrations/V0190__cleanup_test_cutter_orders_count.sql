UPDATE salary_accruals SET amount = 0, description = 'Тестовая запись, отменена'
WHERE shift_session_id IN (SELECT id FROM shift_sessions WHERE user_id = 9 AND opened_at::date = CURRENT_DATE - 1)
  AND type = 'penalty';

UPDATE shift_sessions SET closed_at = opened_at
WHERE user_id = 9 AND opened_at::date = CURRENT_DATE - 1;