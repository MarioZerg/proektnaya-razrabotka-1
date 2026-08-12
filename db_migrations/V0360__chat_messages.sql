-- Общий чат сотрудников.
--
-- В цехе и на складе люди работают в разных помещениях и на разных сменах: вопрос
-- «где рулон Лена?» или «кто забрал вешалку 12?» решался криком через цех или
-- личными сообщениями в мессенджере, мимо системы. Здесь переписка живёт рядом с
-- работой и видна всем, кто на смене.
CREATE TABLE chat_messages (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    -- Имя автора храним копией: сотрудник может уволиться, а история переписки
    -- должна остаться читаемой.
    user_name VARCHAR(200) NOT NULL,
    text TEXT NOT NULL,
    -- Скрытие сообщения: оно исчезает из ленты, но остаётся в базе — иначе нельзя
    -- разобрать конфликт «я такого не писал».
    hidden_at TIMESTAMP NULL,
    hidden_by INTEGER NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Лента всегда читается «свежие сверху» и порциями, плюс постоянный опрос новых
-- сообщений по id — без индекса каждый опрос был бы полным перебором таблицы.
CREATE INDEX idx_chat_messages_id_desc ON chat_messages (id DESC) WHERE hidden_at IS NULL;
