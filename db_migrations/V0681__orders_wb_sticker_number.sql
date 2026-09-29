-- ЦИФРОВОЙ КОД СТИКЕРА WB — ТО, ЧТО РЕАЛЬНО СКАНИРУЕТ КЛАДОВЩИК.
--
-- На термоярлыке WB печатается ДВА представления одного и того же кода:
--   * буквенный вид  *DZ5QqmEj — его отдаёт API в поле barcode, мы храним его
--     в orders.wb_sticker_barcode;
--   * цифровой вид  5849066 1473 (partA + partB) — именно он напечатан крупно
--     под штрихкодом, и именно его сканер отдаёт в поле ввода.
-- Цифры — это первые 5 байт base64-кода как одно 40-битное число:
--   *DZ5QqmEj -> base64 -> 0d 9e 75 0a a6 -> 58490661473.
--
-- Из-за этого скан не работал: в базе лежал только буквенный вид, а приходили
-- цифры. Сканер отвечал «возврат по коду … не найден», хуже того — 11 цифр
-- подходили под маску номера заказа Яндекса, и код WB уходил искать к Яндексу.
--
-- Считаем число прямо из хранимого кода генерируемой колонкой: отдельное поле
-- не нужно заполнять и оно не может разойтись с barcode. Пустые и непохожие на
-- base64 значения дают NULL, а не ошибку вставки.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS wb_sticker_number bigint
    GENERATED ALWAYS AS (
        CASE WHEN wb_sticker_barcode ~ '^\*?[A-Za-z0-9+/]{8}$'
             THEN ('x' || encode(substring(
                      decode(ltrim(wb_sticker_barcode, '*'), 'base64') from 1 for 5
                  ), 'hex'))::bit(40)::bigint
        END
    ) STORED;

-- Поиск идёт по одному скану — нужен точный индекс.
CREATE INDEX IF NOT EXISTS idx_orders_wb_sticker_number
    ON orders (wb_sticker_number) WHERE wb_sticker_number IS NOT NULL;
