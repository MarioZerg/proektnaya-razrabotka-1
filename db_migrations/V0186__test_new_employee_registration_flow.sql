INSERT INTO users (login, password_hash, password_salt, full_name, role, phone,
                   max_user_id, registered_via_max, is_active)
VALUES ('maxtest990001', 'x', 'y', 'Новый Сотрудник', '', '+79995550011',
        '990001', true, true);

INSERT INTO max_auth_sessions (max_user_id, code, phone, full_name, expires_at, used)
VALUES ('990001', '424242', '+79995550011', 'Новый Сотрудник', now() + interval '1 day', false);