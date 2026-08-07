-- Блокировка поставки на время сборки.
-- Двое кладовщиков, собирающие одну поставку одновременно, ломают раскладку по
-- коробкам: каждый видит свою картину и кладёт заказы в чужие короба.
-- Поэтому поставку «занимает» тот, кто зашёл в сборку первым.
ALTER TABLE marketplace_supplies
  ADD COLUMN IF NOT EXISTS locked_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;

-- Быстрый поиск «занятых» поставок при снятии протухших блокировок.
CREATE INDEX IF NOT EXISTS idx_supplies_locked
  ON marketplace_supplies (locked_by) WHERE locked_by IS NOT NULL;