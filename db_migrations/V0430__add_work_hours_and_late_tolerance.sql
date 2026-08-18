ALTER TABLE users ADD COLUMN IF NOT EXISTS work_hours numeric(4,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS late_tolerance_minutes integer DEFAULT 0;

UPDATE users
SET work_hours = ROUND(
  EXTRACT(EPOCH FROM (
    CASE WHEN shift_to <= shift_from
         THEN (shift_to::time + interval '24 hours') - shift_from::time
         ELSE shift_to::time - shift_from::time END
  )) / 3600.0, 2)
WHERE shift_from IS NOT NULL AND shift_to IS NOT NULL AND work_hours IS NULL;

COMMENT ON COLUMN users.work_hours IS 'Сколько часов сотрудник работает за смену';
COMMENT ON COLUMN users.shift_from IS 'Во сколько сотрудник должен открыть смену';
COMMENT ON COLUMN users.late_tolerance_minutes IS 'Допустимое опоздание в минутах';