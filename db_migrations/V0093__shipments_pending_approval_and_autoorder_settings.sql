-- Поддержка подтверждения поставки от поставщика админом:
-- позиции сохраняются без рулонов (roll_id/barcode = NULL) до подтверждения,
-- number_rolls хранит запрошенное кладовщиком число рулонов/пачек
ALTER TABLE shipment_items ADD COLUMN IF NOT EXISTS number_rolls INTEGER NULL;

-- Настройки автозаказа материала в цех при низком остатке
INSERT INTO system_settings (key, value) VALUES
    ('auto_order_enabled', 'true'),
    ('auto_order_threshold', '100'),
    ('auto_order_quantity', '300')
ON CONFLICT (key) DO NOTHING;