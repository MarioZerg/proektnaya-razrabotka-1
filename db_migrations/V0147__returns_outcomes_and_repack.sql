-- Возврат проходит два разных этапа с разной ответственностью:
--   1) админ решает по заявке на маркетплейсе (одобрить/отклонить) — статус approved/rejected;
--   2) кладовщик принимает физически приехавшую вещь и решает её судьбу.
-- Судьба вещи (outcome): utilized — повреждена, утилизирована; repack — годная, но нужна
-- перепаковка в цехе; stored — сразу на полку хранения.
ALTER TABLE marketplace_returns ADD COLUMN IF NOT EXISTS outcome VARCHAR(20);
ALTER TABLE marketplace_returns ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMP;
ALTER TABLE marketplace_returns ADD COLUMN IF NOT EXISTS outcome_by INTEGER REFERENCES users(id);
-- Комментарий кладовщика: чем именно повреждён товар (для отчёта админу по утилизации).
ALTER TABLE marketplace_returns ADD COLUMN IF NOT EXISTS damage_note TEXT;
-- Штрихкод стикера возврата с коробки маркетплейса — по нему кладовщик сканирует вещь.
ALTER TABLE marketplace_returns ADD COLUMN IF NOT EXISTS return_barcode VARCHAR(100);
-- Кто и когда одобрил заявку (админ), чтобы кладовщик видел только одобренные.
ALTER TABLE marketplace_returns ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE marketplace_returns ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_marketplace_returns_barcode
    ON marketplace_returns (return_barcode) WHERE return_barcode IS NOT NULL;

-- Вещь на перепаковке в цехе: упаковщик видит её на терминале в отдельной плашке
-- «Перепаковка», переупаковывает и возвращает на склад.
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS repack_return_id INTEGER
    REFERENCES marketplace_returns(id);
