CREATE TABLE IF NOT EXISTS floor_race_wins (
    race_date date PRIMARY KEY,
    winner_user_id integer NOT NULL REFERENCES users(id),
    winner_name text,
    steps integer NOT NULL,
    variki integer NOT NULL DEFAULT 50,
    won_at timestamptz NOT NULL DEFAULT now()
);