ALTER TABLE t_p86119184_proektnaya_razrabotk.shift_sessions
  ADD COLUMN IF NOT EXISTS overtime_allowed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS overtime_allowed_by INTEGER;