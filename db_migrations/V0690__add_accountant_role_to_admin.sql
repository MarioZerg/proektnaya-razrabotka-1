-- Бухгалтер появился позже остальных должностей: в меню админа, где по одному
-- аккаунту на роль, его не было. Добавляем утверждённую роль администраторам,
-- чтобы можно было открыть панель бухгалтера так же, как остальные.
INSERT INTO user_roles (user_id, role, is_approved)
SELECT DISTINCT u.id, 'accountant', true
FROM users u
JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'admin' AND ur.is_approved = true
WHERE u.is_active = true
  AND u.contract_terminated_at IS NULL
ON CONFLICT (user_id, role) DO UPDATE SET is_approved = true;
