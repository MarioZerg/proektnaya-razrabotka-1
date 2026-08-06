UPDATE salary_accruals SET amount = 0, description = 'Тестовая запись, отменена'
WHERE shift_session_id = 23 AND type = 'penalty';

UPDATE shift_sessions SET closed_at = opened_at WHERE id = 23;