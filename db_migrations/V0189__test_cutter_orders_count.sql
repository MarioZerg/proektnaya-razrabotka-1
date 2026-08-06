INSERT INTO shift_sessions (user_id, workshop_id, shift_number, role, opened_at, closed_at)
VALUES (9, 1, 1, 'cutter', (CURRENT_DATE - 1) + time '09:00', NULL);