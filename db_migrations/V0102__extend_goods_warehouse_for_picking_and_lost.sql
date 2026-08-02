-- Расширяем склад готового товара: стикер хранения (уникальный штрихкод, генерируется при
-- приёмке), статус "На сборке" (picking) для этапа предварительного отбора перед поставкой,
-- статус "Утерян" (lost) с причиной и датой отметки.
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS storage_barcode VARCHAR(50) UNIQUE;
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS lost_reason TEXT;
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS lost_at TIMESTAMP;

-- Заполняем storage_barcode для уже существующих записей (последовательный штрихкод GW-000001).
UPDATE goods_warehouse SET storage_barcode = 'GW-' || LPAD(id::text, 6, '0') WHERE storage_barcode IS NULL;

ALTER TABLE goods_warehouse ALTER COLUMN storage_barcode SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goods_warehouse_storage_barcode ON goods_warehouse(storage_barcode);
