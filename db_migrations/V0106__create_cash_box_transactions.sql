-- Касса компании — учёт реальных денег, из которых выплачивается зарплата (раньше система
-- считала только начисления/выплаты, без привязки к фактическому остатку денег компании).
-- Каждая строка — операция изменения баланса: пополнение (amount > 0, вручную админом) или
-- списание на выплату зарплаты (amount < 0, автоматически при action 'payout').
CREATE TABLE cash_box_transactions (
    id SERIAL PRIMARY KEY,
    amount NUMERIC(12,2) NOT NULL,
    description TEXT NOT NULL,
    payout_id INTEGER NULL REFERENCES salary_payouts(id),
    created_by INTEGER NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_cash_box_transactions_created_at ON cash_box_transactions(created_at);
