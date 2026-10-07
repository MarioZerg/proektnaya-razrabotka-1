-- Кладовщик при приёмке с ПВЗ может отметить, что в пакете не тот товар
-- (покупатель подменил вещь на пункте выдачи). Отметка живёт на заявке возврата:
-- админ видит её в уведомлении, повторный клик не плодит вторую запись.
ALTER TABLE marketplace_returns
    ADD COLUMN IF NOT EXISTS pvz_substitution BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE marketplace_returns
    ADD COLUMN IF NOT EXISTS pvz_substitution_at TIMESTAMP;
ALTER TABLE marketplace_returns
    ADD COLUMN IF NOT EXISTS pvz_substitution_by INTEGER REFERENCES users(id);

COMMENT ON COLUMN marketplace_returns.pvz_substitution IS
    'Кладовщик отметил подмену товара на ПВЗ: в пакете не то, что в заявке';
