-- РАСТОРЖЕНИЕ ДОГОВОРА по инициативе сотрудника.
--
-- Порядок ровно как в договоре ГПХ (раздел 5):
--   1. Сотрудник подаёт заявление в личном кабинете. Дата прекращения —
--      строго через 14 дней (п. 5.2), раньше нельзя;
--   2. подписывает Акт кодом из MAX — той же подписью, что и сам договор;
--   3. администратор подтверждает или отклоняет с причиной;
--   4. после подтверждения доступ закрывается (п. 5.7), но аккаунт остаётся:
--      расчёты по нему продолжаются, история работы нужна для выплат.
--
-- Аккаунт НЕ удаляем принципиально: прекращение доступа — техническая мера
-- защиты данных, а не отказ от денежных обязательств (п. 5.7 договора).
CREATE TABLE IF NOT EXISTS contract_terminations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    -- Какой договор расторгается.
    contract_id INTEGER REFERENCES contracts(id),

    -- pending_sign  — заявление создано, ждём подпись сотрудника кодом
    -- pending_admin — сотрудник подписал, ждём подтверждения администратора
    -- confirmed     — администратор подтвердил, доступ закрыт
    -- rejected      — администратор отклонил с причиной
    -- cancelled     — сотрудник передумал до подписания
    status VARCHAR(20) NOT NULL DEFAULT 'pending_sign',

    -- Дата, с которой договор прекращается: заявление + 14 дней (п. 5.2).
    termination_date DATE NOT NULL,
    -- Причина ухода со слов сотрудника — необязательна, для истории.
    reason TEXT,

    -- Акт о расторжении: тот же путь, что у договоров.
    file_url TEXT,
    file_name VARCHAR(300),

    created_at TIMESTAMP NOT NULL DEFAULT now(),

    -- Подпись сотрудника: код из MAX, время, телефон и адрес — тот же состав
    -- реквизитов, что и при подписании договора, иначе Акт слабее самого
    -- договора по доказательной силе.
    signed_at TIMESTAMP,
    signed_code VARCHAR(10),
    signed_phone VARCHAR(30),
    signed_ip VARCHAR(60),

    -- Решение администратора.
    confirmed_at TIMESTAMP,
    confirmed_by INTEGER REFERENCES users(id),
    rejected_at TIMESTAMP,
    rejected_by INTEGER REFERENCES users(id),
    reject_reason TEXT
);

-- Одно активное заявление на сотрудника: два параллельных расторжения одного
-- договора — это спор о том, какое из них считать действительным.
CREATE UNIQUE INDEX IF NOT EXISTS idx_termination_active
    ON contract_terminations (user_id)
    WHERE status IN ('pending_sign', 'pending_admin');

CREATE INDEX IF NOT EXISTS idx_termination_status
    ON contract_terminations (status);

COMMENT ON TABLE contract_terminations IS
    'Заявления о расторжении договора ГПХ по инициативе сотрудника';

-- Одноразовые коды подписи Акта. Отдельно от кодов договора: у них разное
-- назначение, и код, выданный на договор, не должен подписывать расторжение.
CREATE TABLE IF NOT EXISTS termination_sign_codes (
    id SERIAL PRIMARY KEY,
    termination_id INTEGER NOT NULL REFERENCES contract_terminations(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    code VARCHAR(10) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_term_codes_lookup
    ON termination_sign_codes (termination_id, code)
    WHERE used_at IS NULL;

-- Метка на сотруднике: договор расторгнут, доступ закрыт.
--
-- Отдельно от is_active: is_active означает «удалён из системы», а здесь
-- человек остаётся в базе со всей историей — просто больше не работает.
ALTER TABLE users ADD COLUMN IF NOT EXISTS contract_terminated_at TIMESTAMP;

COMMENT ON COLUMN users.contract_terminated_at IS
    'Договор расторгнут, доступ закрыт. Аккаунт и история сохраняются';
