-- Штрихкоды двум товарам, у которых их не было.
--
-- Штрихкод нужен упаковщице: по нему товар отмечается на терминале при стикеровке.
-- Без него вещь невозможно провести через конвейер.
--
-- Формат — внутренний EAN-13 (префикс 20, как у остальных 673 товаров), номера
-- продолжают занятую серию 20514138. Контрольная цифра рассчитана по стандарту EAN-13,
-- поэтому такой код корректно печатается и читается сканером.
UPDATE t_p86119184_proektnaya_razrabotk.marketplace_items
SET barcode = '2051413878012', updated_at = now()
WHERE id = 679 AND (barcode IS NULL OR barcode = '');

UPDATE t_p86119184_proektnaya_razrabotk.marketplace_items
SET barcode = '2051413878029', updated_at = now()
WHERE id = 414 AND (barcode IS NULL OR barcode = '');
