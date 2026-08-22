-- Убыточные товары в начислении менеджера.
--
-- Правило. Менеджер получает процент только с товаров, которые принесли доход.
-- Вещь, проданная ниже юнит-экономики (в минус), вознаграждение не приносит:
-- премировать за убыточную продажу не за что.
--
-- Как считаем. Из суммы к перечислению вычитаем долю убыточных продаж, и уже
-- с остатка берём процент. В отчёте показываем обе цифры, чтобы человек видел,
-- сколько и почему вычли, а не гадал над уменьшившейся суммой.
ALTER TABLE manager_accruals
    -- Сколько вещей ушло в минус по юнит-экономике.
    ADD COLUMN IF NOT EXISTS loss_units INTEGER NOT NULL DEFAULT 0,
    -- Их доля в сумме к перечислению — она и вычитается из базы.
    ADD COLUMN IF NOT EXISTS loss_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    -- База после вычета: с неё считается процент.
    ADD COLUMN IF NOT EXISTS payable_base NUMERIC(14, 2);

-- Учитывать ли убыточные продажи. Выключатель нужен: правило может
-- пересматриваться, а переписывать расчёт ради этого не стоит.
ALTER TABLE manager_commission_settings
    ADD COLUMN IF NOT EXISTS skip_loss_items BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN manager_accruals.loss_amount IS
    'Доля убыточных продаж: вычитается из базы, процент с неё не платится';
COMMENT ON COLUMN manager_commission_settings.skip_loss_items IS
    'Не начислять процент с товаров, проданных ниже юнит-экономики';
