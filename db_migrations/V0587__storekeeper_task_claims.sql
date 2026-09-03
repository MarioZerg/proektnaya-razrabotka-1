-- Метка «беру задание на себя»: кладовщики работают на своих аккаунтах, и одно
-- и то же дело они раньше делали вдвоём — оба бежали в цех за одними вещами.
--
-- Метка живёт на КАЛЕНДАРНЫЙ ДЕНЬ, а не на смену: смены у двоих разные (один
-- пришёл в 8, другой в 10), и привязка к смене не дала бы второму увидеть, что
-- дело уже занято.
CREATE TABLE IF NOT EXISTS storekeeper_task_claims (
    id SERIAL PRIMARY KEY,
    task_key VARCHAR(64) NOT NULL,
    -- Дата по Москве: рабочий день считается по местным часам, а не по UTC.
    claim_date DATE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    claimed_at TIMESTAMP NOT NULL DEFAULT now(),
    -- Одно задание в один день может быть занято только одним человеком.
    CONSTRAINT storekeeper_task_claims_uniq UNIQUE (task_key, claim_date)
);

CREATE INDEX IF NOT EXISTS storekeeper_task_claims_date_idx
    ON storekeeper_task_claims (claim_date);
