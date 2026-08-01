ALTER TABLE users ADD COLUMN IF NOT EXISTS max_user_id VARCHAR(50);

CREATE TABLE IF NOT EXISTS max_login_codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    code VARCHAR(10) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_max_login_codes_user_id ON max_login_codes(user_id);