-- Глобальные системные настройки (значения по умолчанию для всех цехов)
CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO system_settings (key, value) VALUES
    ('working_day_start', '08:00'),
    ('working_day_end', '20:00'),
    ('is_enabled_work_schedule', 'true'),
    ('api_key_wb', ''),
    ('api_key_ozon', ''),
    ('seller_id_ozon', ''),
    ('max_quantity_orders_to_seamstress', '80'),
    ('orders_priority', 'ozon_first'),
    ('late_opened_shift_penalty', '1000'),
    ('unclosed_shift_penalty', '1000'),
    ('is_enabled_work_shift', 'true'),
    ('max_quantity_orders_to_cutter', '20'),
    ('cutter_daily_limit', '200'),
    ('cancel_order_penalty', '200'),
    ('seamstress_daily_limit', '200'),
    ('max_quantity_orders_without_timeout', '2'),
    ('timeout_200', '8'),
    ('timeout_300', '8'),
    ('timeout_400', '10'),
    ('timeout_500', '12'),
    ('timeout_600', '12'),
    ('timeout_700', '15'),
    ('timeout_800', '15'),
    ('print_qr_cutting', 'enabled'),
    ('sticking_otk', 'scanner'),
    ('sticking_seamstress', 'scanner'),
    ('orders_filter', 'all'),
    ('orders_cluster_priority', ''),
    ('max_fabric_rolls_per_shift', '30')
ON CONFLICT (key) DO NOTHING;

-- Дополнительные поля цеха: разрешённые товары/материалы (массивы id материалов в JSON)
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS allowed_products JSONB NOT NULL DEFAULT '[]';
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS allowed_materials JSONB NOT NULL DEFAULT '[]';

-- Переопределения настроек по цехам: NULL значение = "используется глобальное"
CREATE TABLE IF NOT EXISTS workshop_settings (
    id SERIAL PRIMARY KEY,
    workshop_id INTEGER NOT NULL REFERENCES workshops(id),
    key VARCHAR(100) NOT NULL,
    value TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (workshop_id, key)
);