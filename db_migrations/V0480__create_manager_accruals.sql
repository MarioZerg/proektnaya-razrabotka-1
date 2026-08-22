-- Начисления менеджеру маркетплейсов: процент с каждой проданной штуки.
--
-- Как это работает.
-- 1. Раз в неделю (среда) закрывается отчёт площадки. Из него берём деньги,
--    фактически перечисленные на расчётный счёт, и делим на количество вещей,
--    за которые они пришли. Получаем сумму, приходящуюся на одну штуку.
-- 2. С каждой штуки менеджеру начисляется её процент. Начисление уходит
--    в ХОЛД на 15 дней: за это время покупатель может вернуть товар.
-- 3. Вернул в холде — начисление аннулируется с указанием причины.
--    Вернул позже — деньги остаются у менеджера, как и договаривались.
-- 4. Через 15 дней начисление подтверждается и попадает в баланс к выплате.
-- 5. Выплата 10 и 25 числа через кассу, как всем сотрудникам.
--
-- ВАЖНО про базу. Начисляем ТОЛЬКО с денег, реально пришедших на расчётный
-- счёт (payments из отчёта площадки), а не с оборота. Комиссия площадки,
-- логистика и услуги в базу не входят — их мы не получаем.
CREATE TABLE IF NOT EXISTS manager_accruals (
    id SERIAL PRIMARY KEY,
    -- Кому начислено.
    user_id INTEGER NOT NULL,
    -- Из какого недельного отчёта.
    payout_id INTEGER,
    marketplace_code VARCHAR(40) NOT NULL DEFAULT 'ozon',
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    -- Сколько вещей закрыто этим отчётом.
    units INTEGER NOT NULL DEFAULT 0,
    -- Перечислено на счёт за эти вещи — база начисления.
    base_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    percent NUMERIC(6, 3) NOT NULL,
    -- Начислено всего и сколько это на одну вещь.
    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    per_unit NUMERIC(12, 4),
    -- hold — ждёт проверки, confirmed — подтверждено, cancelled — аннулировано.
    status VARCHAR(20) NOT NULL DEFAULT 'hold',
    -- Когда холд заканчивается: до этой даты возврат снимает начисление.
    hold_until DATE NOT NULL,
    confirmed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    -- Почему аннулировано: человек должен видеть причину, а не голый минус.
    cancel_reason TEXT,
    -- Сколько вещей вернули и на какую сумму уменьшено начисление.
    returned_units INTEGER NOT NULL DEFAULT 0,
    returned_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accruals_period
    ON manager_accruals (user_id, marketplace_code, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_accruals_status
    ON manager_accruals (user_id, status, hold_until);

-- Кто получает процент. Пока это один человек, но привязка к сотруднику
-- нужна: договорённость может перейти к другому, а история должна остаться.
ALTER TABLE manager_commission_settings
    ADD COLUMN IF NOT EXISTS user_id INTEGER,
    -- Сколько дней держим начисление до подтверждения.
    ADD COLUMN IF NOT EXISTS hold_days INTEGER NOT NULL DEFAULT 15;

COMMENT ON TABLE manager_accruals IS
    'Начисления менеджеру: процент с денег, пришедших на счёт, с холдом 15 дней';
COMMENT ON COLUMN manager_accruals.base_amount IS
    'Перечислено на расчётный счёт — только эти деньги идут в базу процента';
