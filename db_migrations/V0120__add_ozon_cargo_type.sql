-- Тип грузоместа для закрытия коробов OZON FBO (cargo_type в API cargoes/create).
-- Значение выбирает пользователь: BOX (короб) или PALLET (палета). По умолчанию BOX.
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS ozon_cargo_type VARCHAR(20) NOT NULL DEFAULT 'BOX';
