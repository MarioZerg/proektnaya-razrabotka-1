-- Разделяем «доставлено» и «вернулось» — чтобы было видно, из чего сложилось
-- итоговое число проданных штук.
--
-- Зачем. Сейчас в базе лежит только чистый итог (доставлено минус возвраты),
-- и проверить его нельзя: непонятно, вычтены возвраты или нет. Вопрос при этом
-- ключевой — на это число делятся все постоянные расходы.
--
-- Храним обе половины: сколько уехало покупателю и сколько приехало обратно.
ALTER TABLE marketplace_ad_spend
    ADD COLUMN IF NOT EXISTS delivered_units INTEGER,
    ADD COLUMN IF NOT EXISTS returned_units INTEGER;

ALTER TABLE marketplace_sync_progress
    ADD COLUMN IF NOT EXISTS delivered_fbo INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS delivered_fbs INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS returned_fbo INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS returned_fbs INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN marketplace_ad_spend.delivered_units IS
    'Штук доставлено покупателю за период (до вычета возвратов)';
COMMENT ON COLUMN marketplace_ad_spend.returned_units IS
    'Штук вернулось обратно: возвраты, отмены, невыкупы';
