-- Отпуска сотрудников производства.
--
-- Правила, которые задал заказчик:
--   * отпуск длится 2 недели (14 дней);
--   * положено 2 отпуска за рабочий год, который отсчитывается от даты первого отпуска
--     сотрудника (а не от января) — то есть примерно раз в полгода;
--   * одновременно в отпуске может быть только один человек от смены цеха: иначе смена
--     останется без людей. В разных сменах отдыхать одновременно можно.

-- Дата первого отпуска — точка отсчёта рабочего года. Задаётся в профиле, от неё
-- система считает, когда сотруднику положен следующий отпуск.
ALTER TABLE t_p86119184_proektnaya_razrabotk.users
    ADD COLUMN IF NOT EXISTS first_vacation_date DATE;

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.users.first_vacation_date IS
    'Дата первого отпуска — начало рабочего года. От неё считается право на следующий отпуск';

CREATE TABLE IF NOT EXISTS t_p86119184_proektnaya_razrabotk.vacations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES t_p86119184_proektnaya_razrabotk.users(id),
    -- Цех и смена на момент оформления: по ним проверяется, что смена не останется пустой.
    workshop_id INTEGER REFERENCES t_p86119184_proektnaya_razrabotk.workshops(id),
    shift_number INTEGER,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    -- Рабочий год, к которому относится отпуск: 1-й, 2-й и так далее от даты первого отпуска.
    work_year INTEGER NOT NULL DEFAULT 1,
    comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by INTEGER REFERENCES t_p86119184_proektnaya_razrabotk.users(id),
    -- Отменённый отпуск не удаляем: нужна история, кто и когда его отменил.
    cancelled_at TIMESTAMP,
    cancelled_by INTEGER REFERENCES t_p86119184_proektnaya_razrabotk.users(id)
);

CREATE INDEX IF NOT EXISTS idx_vacations_user
    ON t_p86119184_proektnaya_razrabotk.vacations(user_id);

-- Индекс для проверки пересечений по смене: ищем действующие отпуска на даты.
CREATE INDEX IF NOT EXISTS idx_vacations_period
    ON t_p86119184_proektnaya_razrabotk.vacations(workshop_id, shift_number, starts_on, ends_on)
    WHERE cancelled_at IS NULL;
