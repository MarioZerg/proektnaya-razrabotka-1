-- Свободный остаток от упаковщицы на рулоне.
--
-- Зачем. При перепаковке иногда нужен перекрой материала, и на руках остаётся
-- годный кусок. Выбрасывать его жалко — упаковщица возвращает кусок на рулон,
-- и с него потом кроят дальше.
--
-- Почему ОТДЕЛЬНОЕ поле, а не плюс к remaining_quantity. Штраф за недостачу
-- считается от фактического остатка на момент закрытия рулона. Если подмешать
-- возвращённые метры в общий остаток, они увеличат "недостачу" и закройщица
-- получит удержание за материал, которого никогда не брала. Поэтому возвраты
-- упаковщиц живут отдельной строкой: расход по ним виден сам по себе, а в
-- расчёт штрафа они не попадают.
ALTER TABLE rolls ADD COLUMN IF NOT EXISTS packer_returned_quantity NUMERIC(12,3) NOT NULL DEFAULT 0;

COMMENT ON COLUMN rolls.packer_returned_quantity IS
  'Метраж, возвращённый упаковщицами при перепаковке. Свободный остаток: расходуется как обычный материал, но в расчёт штрафа за недостачу НЕ входит.';

-- История возвратов: кто, сколько и когда вернул. Без неё нельзя показать
-- расход по свободному остатку отдельно от основного метража рулона.
CREATE TABLE IF NOT EXISTS roll_packer_returns (
    id SERIAL PRIMARY KEY,
    roll_id INTEGER NOT NULL,
    quantity NUMERIC(12,3) NOT NULL,
    goods_warehouse_id INTEGER NULL,
    user_id INTEGER NULL,
    user_name VARCHAR(255) NULL,
    note TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roll_packer_returns_roll ON roll_packer_returns(roll_id);
CREATE INDEX IF NOT EXISTS idx_roll_packer_returns_created ON roll_packer_returns(created_at);