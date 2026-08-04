-- Для стикера FBO OZON нужен ozon_sku товара (по нему товар добавляется в поставку FBO),
-- а не его штрихкод (barcode). Храним отдельным полем, чтобы не путать с product_barcode.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_ozon_sku VARCHAR(100);

-- Заполняем у заказов, уже привязанных к товару справочника.
UPDATE orders o
SET product_ozon_sku = mi.ozon_sku
FROM marketplace_items mi
WHERE o.marketplace_item_id = mi.id
  AND mi.ozon_sku IS NOT NULL AND mi.ozon_sku <> ''
  AND (o.product_ozon_sku IS NULL OR o.product_ozon_sku = '');