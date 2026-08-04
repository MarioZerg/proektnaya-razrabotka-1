-- Справочник вешалок: админ заводит номера, закройщик при раскрое выбирает вешалку.
CREATE TABLE IF NOT EXISTS hangers (
    id SERIAL PRIMARY KEY,
    number INTEGER UNIQUE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Последняя вешалка, выбранная закройщиком. Подставляется по умолчанию в его следующих
-- заказах при раскрое, пока он сам не сменит номер.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_hanger_number INTEGER;