INSERT INTO users (login, password_hash, password_salt, full_name, role, phone,
                   telegram_user_id, registered_via_telegram, is_active)
VALUES ('tgtest9001', 'x', 'y', 'Тестовая Заявка Ивановна', '', '+79990001122',
        '9001', true, true);

INSERT INTO user_roles (user_id, role, is_approved)
SELECT id, 'sewer', false FROM users WHERE login = 'tgtest9001';