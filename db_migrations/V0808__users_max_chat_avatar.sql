-- Личный чат сотрудника с ботом MAX: только в его описании MAX отдаёт фото
-- профиля (метода «данные пользователя по id» у MAX нет).
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_chat_id TEXT;
-- Исходная ссылка MAX на фото: не перекачивать то же самое при каждом входе.
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_avatar_src TEXT;
-- Когда последний раз спрашивали MAX о фото (не чаще раза в 6 часов).
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_avatar_checked_at TIMESTAMP;
