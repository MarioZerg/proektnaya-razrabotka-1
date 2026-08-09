-- Ускоряем частые запросы: заказов и движений накопились тысячи.

-- Конвейер фильтрует заказы по этапу производства на каждой странице.
-- Без индекса база каждый раз перебирает все 1250 заказов.
CREATE INDEX IF NOT EXISTS idx_orders_sewing_status
  ON orders (sewing_status);

-- Список заказов сортируется по дате заказа покупателя вместе с этапом.
CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders (sewing_status, marketplace_created_at);

-- История движения материала — 348 тысяч записей. Карточка рулона и отчёты
-- смотрят их по дате, без индекса это перебор всей таблицы.
CREATE INDEX IF NOT EXISTS idx_material_movements_created_at
  ON material_movements (created_at DESC);

-- Поиск рулона по штрихкоду теперь идёт в базе (ILIKE), а не в браузере.
-- Индекс для поиска по началу строки — самый частый случай на складе.
CREATE INDEX IF NOT EXISTS idx_rolls_barcode_pattern
  ON rolls (barcode varchar_pattern_ops);

-- Список рулонов сортируется по дате создания.
CREATE INDEX IF NOT EXISTS idx_rolls_created_at
  ON rolls (created_at DESC);
