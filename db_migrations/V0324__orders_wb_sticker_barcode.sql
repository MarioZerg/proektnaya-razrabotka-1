-- Штрихкод с ярлыка Wildberries.
--
-- На стикере WB печатается собственный штрихкод (и части partA/partB), а не номер
-- сборочного задания. Сканер кладовщика считывает именно его, поэтому в поставке вещь
-- «не находилась» — в базе хранится только номер заказа.
--
-- Запоминаем штрихкод в момент печати стикера: тогда при сканировании в поставку
-- заказ находится сразу, без обращения к WB.
ALTER TABLE t_p86119184_proektnaya_razrabotk.orders
    ADD COLUMN IF NOT EXISTS wb_sticker_barcode VARCHAR(60);

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.orders.wb_sticker_barcode IS
    'Штрихкод с ярлыка WB — по нему кладовщик сканирует вещь в поставку';

CREATE INDEX IF NOT EXISTS idx_orders_wb_sticker_barcode
    ON t_p86119184_proektnaya_razrabotk.orders (wb_sticker_barcode)
    WHERE wb_sticker_barcode IS NOT NULL;
