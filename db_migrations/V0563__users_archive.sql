-- АРХИВ УВОЛЕННЫХ СОТРУДНИКОВ.
--
-- Раньше уволенного можно было только удалить, а удалять нельзя: к сотруднику
-- привязаны смены, зарплаты, сшитые вещи, приёмки и брак. Удалишь — и история
-- по товару рвётся: непонятно, кто шил вещь, которая вернулась с браком.
--
-- Поэтому вместо удаления — архив: человек остаётся в базе со всей историей,
-- но исчезает из рабочих списков и не может войти в систему.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS archived_by INTEGER NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS archive_reason TEXT NULL;

-- Списки сотрудников почти всегда просят только работающих — индекс по дате
-- архивации делает такую выборку дешёвой.
CREATE INDEX IF NOT EXISTS idx_users_archived_at ON users (archived_at);

COMMENT ON COLUMN users.archived_at IS 'Когда сотрудник уволен и убран из рабочих списков. NULL — работает.';
COMMENT ON COLUMN users.archived_by IS 'Кто из администраторов отправил сотрудника в архив.';
COMMENT ON COLUMN users.archive_reason IS 'Причина увольнения — видна в архиве и в истории по товару.';
