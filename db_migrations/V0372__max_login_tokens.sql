-- Одноразовая метка сессии входа: связывает вкладку сайта с чатом в MAX.
--
-- Раньше вход был ручным: человек шёл в бота, слал номер, ЗАПОМИНАЛ шестизначный код,
-- возвращался на сайт и вводил его руками. Метка убирает последний шаг: сайт кладёт
-- её в ссылку на бота, бот по ней узнаёт, какая именно вкладка ждёт входа, и кладёт
-- готовый код обратно — вкладка забирает его сама.
CREATE TABLE IF NOT EXISTS max_login_tokens (
    id          SERIAL PRIMARY KEY,
    token       VARCHAR(64) NOT NULL UNIQUE,
    -- Заполняется ботом, когда человек открыл чат по ссылке с этой меткой.
    max_user_id VARCHAR(64),
    -- Готовый код входа. Пока NULL — сайт продолжает ждать.
    code        VARCHAR(6),
    -- Взводится, когда боту нужен номер телефона (человек в системе ещё не known):
    -- сайт по этому признаку показывает подсказку «нажмите кнопку в чате».
    awaiting_contact BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    expires_at  TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_max_login_tokens_token ON max_login_tokens(token);
-- Бот ищет незакрытую метку этого человека, когда тот присылает контакт вторым шагом.
CREATE INDEX IF NOT EXISTS idx_max_login_tokens_user ON max_login_tokens(max_user_id, expires_at);
