-- Отметки кладовщика по заданиям смены.
--
-- Большинство заданий система проверяет сама по данным: подбор пуст, отменённых в
-- цехе нет, возвраты разобраны. Но два задания проверить по данным нельзя, их
-- закрывает сам человек:
--   * отгрузка ткани в цех — материала может просто не быть на складе, и тогда
--     отгружать нечего. Без ручной отметки кладовщик не смог бы закрыть смену
--     из-за задания, которое от него не зависит;
--   * напоминание закройщикам про рулоны с малым остатком — это разговор в цехе,
--     в системе он никак не отражается.
--
-- Отметка привязана к КОНКРЕТНОЙ СМЕНЕ, а не к дате: у человека может быть две
-- смены за день (своя и гостевая в другом цехе), и галочка одной не должна
-- закрывать задание в другой.
CREATE TABLE IF NOT EXISTS storekeeper_shift_tasks (
    id SERIAL PRIMARY KEY,
    shift_session_id INTEGER NOT NULL REFERENCES shift_sessions(id),
    -- Код задания: fabric_shipment (отгрузка ткани), rolls_reminder (напомнить
    -- закройщикам про рулоны). Строкой, а не числом — в логах и запросах сразу
    -- видно, о каком задании речь.
    task_key VARCHAR(40) NOT NULL,
    done_at TIMESTAMP NOT NULL DEFAULT now(),
    -- Кто отметил. Обычно сам кладовщик, но админ может закрыть за него.
    done_by INTEGER REFERENCES users(id),
    -- Одна отметка на задание в смене: повторное нажатие ничего не задваивает.
    CONSTRAINT storekeeper_shift_tasks_unique UNIQUE (shift_session_id, task_key)
);

CREATE INDEX IF NOT EXISTS idx_storekeeper_shift_tasks_session
    ON storekeeper_shift_tasks (shift_session_id);

-- Поставки FBS, попавшие в задания смены.
--
-- Задание «отгрузить поставки» появляется, когда кладовщик создал поставку FBS.
-- Пока она не закрыта, смену закрыть нельзя — иначе собранная поставка останется
-- висеть до завтра, а маркетплейс ждёт её сегодня. Запоминаем ИМЕННО те поставки,
-- что кладовщик создал в свою смену: чужие и вчерашние его не держат.
CREATE TABLE IF NOT EXISTS storekeeper_shift_supplies (
    id SERIAL PRIMARY KEY,
    shift_session_id INTEGER NOT NULL REFERENCES shift_sessions(id),
    supply_id INTEGER NOT NULL REFERENCES marketplace_supplies(id),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT storekeeper_shift_supplies_unique UNIQUE (shift_session_id, supply_id)
);

CREATE INDEX IF NOT EXISTS idx_storekeeper_shift_supplies_session
    ON storekeeper_shift_supplies (shift_session_id);