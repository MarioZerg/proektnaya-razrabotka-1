-- ДНЕВНЫЕ АКЦИИ для швей: разовый вызов на один день, помимо месячной премии.
--
-- Первая акция — сегодня, 14.08.2026: сдал 300 пог.м. на стикеровку → +1000 ₽ на баланс.
--
-- Условия храним в таблице, а не в коде: акции придумываются на ходу («запусти на
-- сегодня»), и каждый раз править и передеплоивать функцию — долго и рискованно.
-- Новая акция теперь это одна строка: дата, цель, сумма.
CREATE TABLE IF NOT EXISTS sewer_daily_challenges (
    id SERIAL PRIMARY KEY,
    -- День акции. Метраж считается строго за эти сутки по дате сдачи на стикеровку.
    challenge_date DATE NOT NULL UNIQUE,
    target_meters NUMERIC(10, 2) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    -- Пояснение для швей на карточке: чем эта акция вызвана.
    title VARCHAR(200) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Кому за акцию уже заплатили. Нужна ровно для одного: премия должна начислиться ОДИН
-- РАЗ. Расчёт идёт при обращении к зарплате, а таких обращений за день десятки — без
-- отметки каждый открывший страницу начислял бы тысячу заново.
CREATE TABLE IF NOT EXISTS sewer_daily_bonus (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    challenge_date DATE NOT NULL,
    -- Метраж на момент начисления: чтобы потом объяснить сотруднику, откуда премия.
    meters NUMERIC(10, 2) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    accrual_id INTEGER NULL REFERENCES salary_accruals(id),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (user_id, challenge_date)
);

-- Сегодняшняя акция.
INSERT INTO sewer_daily_challenges (challenge_date, target_meters, amount, title)
VALUES ('2026-08-14', 300, 1000, 'Акция дня')
ON CONFLICT (challenge_date) DO UPDATE
SET target_meters = EXCLUDED.target_meters, amount = EXCLUDED.amount;
