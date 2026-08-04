-- Ручная корректировка товара len2_225: на WB у него другой vendorCode, поэтому автосинк
-- не сопоставил nmID. Проставляем wb_sku вручную и очищаем ошибочный штрихкод (в поле
-- barcode по ошибке попал OZON-код с приставкой OZN, а не реальный штрихкод товара).
UPDATE marketplace_items
SET wb_sku = '231087053',
    barcode = NULL,
    updated_at = now()
WHERE sku = 'len2_225';