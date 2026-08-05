ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS role VARCHAR(50);

COMMENT ON COLUMN shift_sessions.role IS 'Должность, в которой сотрудник работает в этой смене и цехе (фиксируется при открытии смены)';