-- Договоры сотрудников с подписанием кодом из MAX.
-- Админ загружает документ на конкретного человека; пока документ не подписан,
-- сотрудник не может работать в системе — при входе его встречает экран подписания.
CREATE TABLE IF NOT EXISTS contracts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title VARCHAR(300) NOT NULL,
    file_url TEXT NOT NULL,
    file_name VARCHAR(300),
    -- pending — ждёт подписи, signed — подписан кодом из MAX, cancelled — отозван админом
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by INTEGER REFERENCES users(id),
    signed_at TIMESTAMP,
    -- Чем именно подписан документ: код из MAX и телефон, на который он пришёл.
    -- Это доказательство подписи, поэтому храним вместе с документом.
    signed_code VARCHAR(10),
    signed_phone VARCHAR(30),
    signed_ip VARCHAR(60)
);

CREATE INDEX IF NOT EXISTS idx_contracts_user ON contracts(user_id, status);

-- Коды подтверждения подписи договора. Отдельно от кодов входа (max_auth_sessions),
-- чтобы код входа нельзя было использовать как подпись и наоборот.
CREATE TABLE IF NOT EXISTS contract_sign_codes (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER NOT NULL REFERENCES contracts(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    code VARCHAR(10) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_contract_sign_codes ON contract_sign_codes(contract_id, code);

-- Согласия на обработку персональных данных и политику конфиденциальности —
-- фиксируем момент, когда человек поставил галочку при регистрации.
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMP;