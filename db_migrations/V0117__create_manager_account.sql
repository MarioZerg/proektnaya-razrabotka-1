-- Тестовый аккаунт менеджера для работы с поставками маркетплейса (в т.ч. заявки OZON FBO).
-- Логин: manager, пароль: manager123 (pbkdf2_hmac sha256, 100000 итераций).
INSERT INTO users (login, password_hash, password_salt, full_name, role, is_active, salary, updated_at, created_at, registered_via_max, shift_free)
SELECT 'manager',
       '15c95b0e1c13a5a6fe85fceb31ab59aeda49857809197a393f10e5a27acb374d',
       'a0a8c7641258459b2700f88669707609',
       'Менеджер маркетплейса', 'manager', true, 0, now(), now(), false, false
WHERE NOT EXISTS (SELECT 1 FROM users WHERE login = 'manager');

INSERT INTO user_roles (user_id, role, is_approved)
SELECT u.id, 'manager', true FROM users u
WHERE u.login = 'manager'
  AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'manager');
