-- Подтверждение общего ярлыка связки.
--
-- Порядок сборки связки Яндекса, как он выглядит у кладовщика:
--   1. сканирует стикеры YM-… — по одному на каждую вещь заказа;
--   2. когда собраны все, загорается второй шаг: отсканировать ОБЩИЙ ярлык
--      маркетплейса — тот самый, который один на весь заказ;
--   3. этот ярлык наклеивается на коробку со связкой.
--
-- Второй шаг нужен как физическая отметка: ярлык существует в одном экземпляре,
-- и без него коробка уедет неопознанной. Раньше система знала только «вещи
-- собраны», но не знала, наклеен ли на коробку ярлык — а это разные вещи.
--
-- Штучный товар этого шага не имеет: у него ярлык клеится прямо на вещь при
-- стикеровке, отдельной коробки нет.
CREATE TABLE IF NOT EXISTS supply_bundle_labels (
    id SERIAL PRIMARY KEY,
    supply_id INTEGER NOT NULL REFERENCES marketplace_supplies(id),
    -- Ключ связки: YM-60603398529.
    group_key VARCHAR(80) NOT NULL,
    -- Что именно отсканировали с ярлыка — для разбора спорных случаев.
    scanned_code VARCHAR(120),
    scanned_at TIMESTAMP NOT NULL DEFAULT now(),
    scanned_by INTEGER REFERENCES users(id),
    scanned_by_name VARCHAR(200)
);

-- Один ярлык на связку в рамках поставки: он и физически один.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bundle_label_uniq
    ON supply_bundle_labels (supply_id, group_key);

COMMENT ON TABLE supply_bundle_labels IS
    'Отметка, что на коробку со связкой наклеен общий ярлык маркетплейса';
