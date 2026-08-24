-- НЕЗАВЕРШЁННЫЙ ШАГ РОБОТА.
--
-- Отправка цен на площадку по всему магазину (674 карточки) не укладывается
-- в отведённые функции 5 секунд: 24 августа шаг оборвался на 559-й карточке.
-- Магазин остался в разнобое — часть цен поднята, часть нет, и в журнале об
-- этом ни строчки.
--
-- Теперь шаг идёт пачками и помнит, где остановился: следующий вызов
-- продолжает с того же места, а не начинает заново и не двигает цены дважды.
CREATE TABLE IF NOT EXISTS price_robot_pending (
    id SERIAL PRIMARY KEY,
    marketplace_code VARCHAR(32) NOT NULL,
    -- Насколько двигаем цены этим шагом, %.
    step_percent NUMERIC(5,2) NOT NULL,
    -- Что это был за шаг: raise, rollback или manual.
    decision VARCHAR(16) NOT NULL,
    -- Причина решения — её допишем в журнал, когда шаг завершится.
    reason TEXT,
    -- Товары, которым цену ещё не отправили.
    remaining_ids JSONB NOT NULL DEFAULT '[]',
    -- Сколько уже отправлено и сколько отклонено за все пачки.
    pushed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP NOT NULL DEFAULT now(),
    started_by INTEGER,
    UNIQUE (marketplace_code)
);

COMMENT ON TABLE price_robot_pending IS
    'Шаг робота, который не успел отправить все цены за один вызов';