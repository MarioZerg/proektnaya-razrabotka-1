-- Привязка заказа к конкретному товару справочника marketplace_items. Нужна, чтобы точно
-- определить штрихкод товара для стикера FBO: на один размер (material/width/height) может
-- приходиться несколько товаров с разными штрихкодами, поэтому связь по размеру неоднозначна.
-- product_barcode заполняется из выбранного товара (marketplace_items.barcode).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS marketplace_item_id INTEGER;