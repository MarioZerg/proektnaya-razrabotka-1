-- Кусок брака не доехал до склада: кладовщик разобрал контейнер, а стикера нет.
-- Раньше такая запись просто вечно висела в «ждёт приёмки» — понять, потерялся
-- кусок или его не сдали, было невозможно. Теперь кладовщик помечает его
-- «не найден» и отправляет админу, а тот решает: удержать с сотрудника или
-- списать как потерянный.
ALTER TABLE material_defects
  ADD COLUMN IF NOT EXISTS missing_at timestamp,
  ADD COLUMN IF NOT EXISTS missing_by integer,
  ADD COLUMN IF NOT EXISTS missing_by_name varchar(255),
  -- Решение админа: penalty (удержать) или writeoff (списать как потерянный).
  ADD COLUMN IF NOT EXISTS resolution varchar(32),
  ADD COLUMN IF NOT EXISTS resolved_at timestamp,
  ADD COLUMN IF NOT EXISTS resolved_by integer,
  ADD COLUMN IF NOT EXISTS resolved_by_name varchar(255),
  ADD COLUMN IF NOT EXISTS resolution_comment text;

-- Выборка «что ждёт решения админа» — самый частый запрос с дашборда.
CREATE INDEX IF NOT EXISTS idx_material_defects_missing
  ON material_defects (missing_at)
  WHERE missing_at IS NOT NULL AND resolved_at IS NULL;