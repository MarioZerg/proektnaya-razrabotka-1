INSERT INTO shift_sessions (user_id, workshop_id, shift_number, role, opened_at, closed_at)
SELECT 9, w.id, 1, 'cutter', (CURRENT_DATE - 1) + time '09:00', NULL
FROM workshops w WHERE w.name = 'Цех №1';

INSERT INTO workshop_settings (workshop_id, key, value)
SELECT w.id, 'unclosed_shift_with_orders_penalty', '500' FROM workshops w WHERE w.name = 'Цех №1'
ON CONFLICT (workshop_id, key) DO UPDATE SET value = '500';

INSERT INTO workshop_settings (workshop_id, key, value)
SELECT w.id, 'unclosed_shift_penalty', '100' FROM workshops w WHERE w.name = 'Цех №1'
ON CONFLICT (workshop_id, key) DO UPDATE SET value = '100';