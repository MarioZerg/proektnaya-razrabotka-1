-- Дуэль за шляпу: камень-ножницы-бумага до 3 побед.
-- Проигравший платит 2500 вариков. Баланс не уходит ниже −10000.
-- Если проиграла владелица шляпы, шляпа и оставшийся срок усиления
-- переходят победительнице.

CREATE TABLE IF NOT EXISTS variki_duels (
    id SERIAL PRIMARY KEY,
    challenger_id INTEGER NOT NULL,
    challenger_name TEXT,
    opponent_id INTEGER NOT NULL,
    opponent_name TEXT,
    hat_key TEXT,
    hat_title TEXT,
    hat_boost_until TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending',
    stake INTEGER NOT NULL DEFAULT 2500,
    challenger_score INTEGER NOT NULL DEFAULT 0,
    opponent_score INTEGER NOT NULL DEFAULT 0,
    winner_id INTEGER,
    round_no INTEGER NOT NULL DEFAULT 1,
    challenger_pick TEXT,
    opponent_pick TEXT,
    reveal_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

COMMENT ON TABLE variki_duels IS
 'Дуэль швей за шляпу. pending — ждём ответ, active — идёт бой, finished — есть победитель.';
