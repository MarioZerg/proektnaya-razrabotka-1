ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_user_id VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS registered_via_telegram BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_user_id_unique
    ON users(telegram_user_id) WHERE telegram_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS telegram_auth_sessions (
    id SERIAL PRIMARY KEY,
    telegram_user_id VARCHAR(50) NOT NULL,
    code VARCHAR(10) NOT NULL,
    phone VARCHAR(30),
    full_name VARCHAR(200),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_telegram_auth_sessions_code ON telegram_auth_sessions(code);