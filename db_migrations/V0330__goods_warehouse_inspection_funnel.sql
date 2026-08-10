-- Воронка осмотра возвратов: шесть этапов движения вещи от приёмки до полки.
--
-- Кладовщик и упаковщицы работают с одним и тем же потоком возвратов, но видят его
-- по-разному. Чтобы не терять вещи «где-то между цехом и складом», каждый этап теперь
-- имеет свой статус, а на странице — свой виджет со счётчиком.
--
-- Маршрут вещи:
--   checking      — принята с возврата, ждёт отправки в цех (виджет «Товар с возврата»)
--   repacking     — передана упаковщицам на осмотр (виджет «На осмотре у упаковщиц»)
--   inspected     — упаковщица осмотрела и наклеила стикер хранения, вещь ждёт кладовщика
--   taken         — кладовщик забрал с производства, но полку ещё не определил
--   in_stock      — лежит на полке (конец маршрута)
--   to_dispose    — направлена на утилизацию, чистит только админ
--
-- Новые статусы (inspected, taken, to_dispose) отдельными значениями, а не флагами:
-- вещь физически может быть только в одном месте, и статус это честно отражает.

-- Кто и когда осмотрел вещь — упаковщица отвечает за своё решение.
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS inspected_at TIMESTAMP;
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS inspected_by INTEGER;

-- Когда кладовщик забрал вещь из цеха: до определения полки она «на руках».
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS taken_at TIMESTAMP;
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS taken_by INTEGER;

-- Утилизация: кто отправил, когда и почему. Без причины вещь не списывается —
-- иначе через месяц никто не вспомнит, за что списали товар.
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS dispose_reason TEXT;
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS disposed_at TIMESTAMP;
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS disposed_by INTEGER;

COMMENT ON COLUMN goods_warehouse.inspected_at IS 'Когда упаковщица осмотрела возврат';
COMMENT ON COLUMN goods_warehouse.taken_at IS 'Когда кладовщик забрал вещь из цеха';
COMMENT ON COLUMN goods_warehouse.dispose_reason IS 'Почему вещь отправлена на утилизацию';

CREATE INDEX IF NOT EXISTS idx_goods_warehouse_status_received
    ON goods_warehouse (status, received_at);
