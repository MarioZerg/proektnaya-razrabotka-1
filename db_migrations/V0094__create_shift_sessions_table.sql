CREATE TABLE shift_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    workshop_id INTEGER NULL REFERENCES workshops(id),
    shift_number INTEGER NULL,
    opened_at TIMESTAMP NOT NULL DEFAULT now(),
    closed_at TIMESTAMP NULL,
    is_late BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_shift_sessions_user ON shift_sessions(user_id);
CREATE INDEX idx_shift_sessions_opened_at ON shift_sessions(opened_at);
CREATE INDEX idx_shift_sessions_open ON shift_sessions(user_id, closed_at) WHERE closed_at IS NULL;