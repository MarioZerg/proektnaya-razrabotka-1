-- Выдаём Андрею (вход через MAX) должность «Старший кладовщик».
-- У него уже есть все остальные должности для переключения, а эта отсутствовала —
-- поэтому после входа через MAX её не было в списке выбора.
INSERT INTO user_roles (user_id, role, is_approved)
VALUES (10, 'senior_storekeeper', true)
ON CONFLICT (user_id, role) DO UPDATE SET is_approved = true;