-- Отметка «тариф подтянут с площадки».
--
-- Настройки заполняются двумя путями: часть менеджер вписывает руками из
-- кабинета, часть теперь приходит по интеграции. Без отметки эти цифры
-- неотличимы, и менеджер не понимает, какие из них устарели и что можно
-- править, а что перезапишется при следующей загрузке.
ALTER TABLE marketplace_tariffs
    ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS synced_fields TEXT;

COMMENT ON COLUMN marketplace_tariffs.synced_at IS
    'Когда тарифы последний раз подтянулись из кабинета площадки';
COMMENT ON COLUMN marketplace_tariffs.synced_fields IS
    'Какие поля пришли с площадки — через запятую. Их менеджер не правит руками';
