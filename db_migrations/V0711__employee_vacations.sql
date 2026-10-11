ALTER TABLE users ADD COLUMN IF NOT EXISTS hired_at date;
CREATE TABLE IF NOT EXISTS employee_vacations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_to >= date_from)
);
CREATE INDEX IF NOT EXISTS idx_employee_vacations_user ON employee_vacations (user_id);
CREATE INDEX IF NOT EXISTS idx_employee_vacations_dates ON employee_vacations (date_from, date_to);