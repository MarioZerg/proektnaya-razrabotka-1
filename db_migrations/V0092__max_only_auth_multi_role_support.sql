-- Регистрация через MAX без логина: находим пользователя по номеру телефона.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30);

-- Уникальность телефона и max_user_id для поиска пользователя при входе.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_max_user_id_unique ON users(max_user_id) WHERE max_user_id IS NOT NULL;

-- Гарантируем уникальность пары (user_id, role) в user_roles.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_user_role_unique ON user_roles(user_id, role);

-- Одноразовые коды для входа через MAX без логина: бот присылает код пользователю
-- по его max_user_id/телефону, сайт принимает только код.
CREATE TABLE IF NOT EXISTS max_auth_sessions (
    id SERIAL PRIMARY KEY,
    max_user_id VARCHAR(50) NOT NULL,
    code VARCHAR(10) NOT NULL,
    phone VARCHAR(30),
    full_name VARCHAR(200),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_max_auth_sessions_code ON max_auth_sessions(code);