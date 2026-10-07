ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS day_started_at TIMESTAMP NULL;
ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS switched_from_session_id INTEGER NULL;
COMMENT ON COLUMN shift_sessions.day_started_at IS 'Начало рабочего дня, если смена открыта переключением должности: от него считается, когда можно закрыть смену';
COMMENT ON COLUMN shift_sessions.switched_from_session_id IS 'Смена в другой должности, закрытая при переключении на терминале';