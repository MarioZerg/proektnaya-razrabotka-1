CREATE TABLE IF NOT EXISTS stocktakes (
    id SERIAL PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    started_by INTEGER NULL,
    started_by_name VARCHAR(200) NULL,
    started_at TIMESTAMP NOT NULL DEFAULT now(),
    closed_at TIMESTAMP NULL,
    approved_by INTEGER NULL,
    approved_by_name VARCHAR(200) NULL,
    approved_at TIMESTAMP NULL,
    reject_reason TEXT NULL,
    note TEXT NULL,
    expected_count INTEGER NOT NULL DEFAULT 0,
    found_count INTEGER NOT NULL DEFAULT 0,
    missing_count INTEGER NOT NULL DEFAULT 0,
    extra_count INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE stocktakes IS
 'Инвентаризация склада готового товара. Кладовщик сканирует стикеры GW по полкам, закрывает пересчёт и отправляет админу на подтверждение. Ненайденные вещи утилизируются только после подтверждения админом.';
COMMENT ON COLUMN stocktakes.status IS
 'in_progress — кладовщик считает; pending_approval — закрыта, ждёт админа; approved — админ подтвердил (недостачи списаны); rejected — админ вернул на пересчёт.';

CREATE TABLE IF NOT EXISTS stocktake_scans (
    id SERIAL PRIMARY KEY,
    stocktake_id INTEGER NOT NULL REFERENCES stocktakes(id),
    goods_warehouse_id INTEGER NULL,
    storage_barcode VARCHAR(50) NOT NULL,
    shelf_id INTEGER NULL,
    expected_shelf_id INTEGER NULL,
    scanned_by INTEGER NULL,
    scanned_by_name VARCHAR(200) NULL,
    scanned_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (stocktake_id, storage_barcode)
);

COMMENT ON TABLE stocktake_scans IS
 'Отсканированные в инвентаризацию стикеры хранения GW. shelf_id — полка, на которой вещь реально нашлась; expected_shelf_id — где она числилась до пересчёта.';

CREATE INDEX IF NOT EXISTS idx_stocktake_scans_stocktake ON stocktake_scans(stocktake_id);
CREATE INDEX IF NOT EXISTS idx_stocktakes_status ON stocktakes(status);
