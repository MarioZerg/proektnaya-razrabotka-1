-- Аккаунт, привязанный к MAX (Андрей), становится основным администратором с доступом
-- ко всем ролям: он переключается между ними прямо в личном кабинете и видит систему
-- глазами любого сотрудника. Это заменяет прежние демо-аккаунты с главной страницы.
UPDATE users SET role = 'admin' WHERE max_user_id = '212227255';

INSERT INTO user_roles (user_id, role, is_approved)
SELECT u.id, r.role, true
FROM users u
CROSS JOIN (VALUES ('admin'), ('manager'), ('storekeeper'), ('sewer'), ('cutter'),
                   ('packer'), ('cleaner')) AS r(role)
WHERE u.max_user_id = '212227255'
ON CONFLICT (user_id, role) DO UPDATE SET is_approved = true;