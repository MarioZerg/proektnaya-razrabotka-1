-- Начисления менеджеру по всем площадкам, а не только по OZON.
--
-- Раньше вознаграждение считалось с одного OZON: остальные площадки просто
-- не попадали в расчёт, хотя менеджер ведёт их так же.
--
-- Правила везде одни: процент с денег, ФАКТИЧЕСКИ пришедших на расчётный
-- счёт, убыточные товары из базы вычитаются, возвраты площадка удерживает
-- сама. Отличается только то, как площадка считает и когда платит.
ALTER TABLE manager_commission_settings
    -- Комиссия площадки за перевод денег продавцу. У Яндекса — 1,6%, она
    -- вычитается из поступления до расчёта процента: этих денег компания
    -- не получает.
    ADD COLUMN IF NOT EXISTS ym_withdraw_percent NUMERIC(6, 3)
        NOT NULL DEFAULT 1.6,
    -- Отсрочка выплаты у Яндекса: отчёт закрывается еженедельно, но деньги
    -- приходят через 4 недели.
    ADD COLUMN IF NOT EXISTS ym_delay_weeks INTEGER NOT NULL DEFAULT 4;

COMMENT ON COLUMN manager_commission_settings.ym_withdraw_percent IS
    'Комиссия Яндекса за вывод средств: вычитается из поступления до расчёта';
COMMENT ON COLUMN manager_commission_settings.ym_delay_weeks IS
    'Отсрочка выплаты Яндекса в неделях';

-- Комиссия за вывод хранится и рядом с самой выплатой: у разных площадок
-- она разная, а в отчёте менеджера нужно показать, сколько удержали.
ALTER TABLE marketplace_payouts
    ADD COLUMN IF NOT EXISTS withdraw_fee NUMERIC(14, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN marketplace_payouts.withdraw_fee IS
    'Удержано площадкой за перевод денег продавцу';

ALTER TABLE manager_accruals
    ADD COLUMN IF NOT EXISTS marketplace_code VARCHAR(30) NOT NULL DEFAULT 'ozon',
    ADD COLUMN IF NOT EXISTS withdraw_fee NUMERIC(14, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN manager_accruals.marketplace_code IS
    'По какой площадке начислено вознаграждение';
COMMENT ON COLUMN manager_accruals.withdraw_fee IS
    'Комиссия площадки за вывод: вычтена из базы до расчёта процента';
