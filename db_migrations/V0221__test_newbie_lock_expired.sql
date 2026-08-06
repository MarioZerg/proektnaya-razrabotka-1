-- ТЕСТ: срок истёк — замок должен сняться сам, без действий администратора.
UPDATE users SET salary_unlock_at = now() - INTERVAL '1 minute' WHERE login = 'test_newbie_lock';