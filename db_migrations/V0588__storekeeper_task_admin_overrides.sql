-- Администратор закрывает пункт чек-листа кладовщика ЗА него — для нештатных
-- ситуаций, когда кладовщик не может закрыть смену из-за висящей работы
-- (например, битая запись, сбой синхронизации), а разобраться руками сейчас
-- нельзя.
--
-- Привязка к КОНКРЕТНОЙ СМЕНЕ (shift_session_id), а не к дню или кладовщику:
-- завтра откроется новая смена — новый id — и чек-лист соберётся заново по
-- живым данным склада, эта отметка на него не действует.
CREATE TABLE IF NOT EXISTS storekeeper_task_admin_overrides (
    id SERIAL PRIMARY KEY,
    shift_session_id INTEGER NOT NULL REFERENCES shift_sessions(id),
    task_key VARCHAR(64) NOT NULL,
    closed_by INTEGER REFERENCES users(id),
    closed_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT storekeeper_task_admin_overrides_uniq UNIQUE (shift_session_id, task_key)
);
