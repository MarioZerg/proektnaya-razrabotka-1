-- Уведомления администратору на панель.
--
-- Кладовщик может отправить вещь со склада обратно в пошив — это списание готового
-- товара и лишняя работа цеха. Раньше такое решение оставалось только в журнале, куда
-- никто не заглядывает: админ узнавал о списании случайно. Теперь событие приходит
-- прямо на дашборд, и админ либо разбирается, либо убирает уведомление.
CREATE TABLE IF NOT EXISTS admin_notifications (
    id SERIAL PRIMARY KEY,
    -- Тип события: по нему подбираем иконку и цвет плитки.
    kind VARCHAR(50) NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    -- Кто инициировал событие — чтобы админ знал, с кем говорить.
    actor_id INTEGER,
    actor_name VARCHAR(255),
    -- Куда перейти по клику (например, карточка товара на складе).
    link TEXT,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    -- Прочитано и убрано админом. Записи не стираем физически: история решений
    -- по складу должна оставаться целой.
    is_read BOOLEAN NOT NULL DEFAULT false,
    hidden_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_active
    ON admin_notifications (created_at DESC)
    WHERE hidden_at IS NULL;

COMMENT ON TABLE admin_notifications IS
    'События для панели администратора: отправки в пошив, списания и прочие решения склада';
