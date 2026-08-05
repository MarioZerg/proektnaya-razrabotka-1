-- Кто закрыл рулон и с какой недостачей: нужно, чтобы копить статистику по недостачам
-- в разрезе тканей и закройщиков. Позже на основе этой статистики введём нормы недостачи
-- и списание за перерасход.
ALTER TABLE rolls ADD COLUMN IF NOT EXISTS closed_by_user_id INTEGER;
ALTER TABLE rolls ADD COLUMN IF NOT EXISTS closed_by_name VARCHAR(255);

-- Норма недостачи по материалу в процентах от целого рулона. Пока NULL — нормы не заданы,
-- система только собирает статистику и никого не штрафует.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS shortage_norm_percent NUMERIC(6,3);

CREATE INDEX IF NOT EXISTS idx_rolls_closed_by ON rolls(closed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_rolls_completed_at ON rolls(completed_at);
