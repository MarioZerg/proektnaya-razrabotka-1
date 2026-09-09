-- СЕССИИ: КТО ИМЕННО ДЕЛАЕТ ЗАПРОС.
--
-- До сих пор исполнитель приходил в теле запроса (actorId, actorRole). Это значит,
-- что любой сотрудник мог из консоли браузера отправить запрос с чужим id или с
-- ролью admin и списать материал от чужого имени. Проверки прав в коде были, но
-- опирались на данные, которые подделываются в одну строку.
--
-- Теперь при входе выдаётся случайный токен, он живёт здесь, и сервер сам смотрит,
-- чей это токен и какая у человека роль. Тело запроса на права больше не влияет.

CREATE TABLE IF NOT EXISTS auth_sessions (
    token       VARCHAR(64) PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    -- Роль, под которой человек вошёл. У совместителей их несколько (швея + упаковщица),
    -- и права считаются по той, в которой он работает прямо сейчас.
    role        VARCHAR(40) NOT NULL,
    -- Админ смотрит панель сотрудника его глазами. Храним, кто это на самом деле:
    -- в журнале должно остаться имя администратора, а не того, в кого он вошёл.
    real_user_id INTEGER NULL REFERENCES users(id),
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMP NOT NULL DEFAULT now(),
    -- Смена длинная, планшет в цехе не выключают — держим сессию долго,
    -- но не вечно: потерянный токен не должен работать годами.
    expires_at  TIMESTAMP NOT NULL DEFAULT now() + interval '30 days'
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
