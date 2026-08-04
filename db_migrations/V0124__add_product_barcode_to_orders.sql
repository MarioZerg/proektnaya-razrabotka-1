-- Штрихкод товара маркетплейса (из marketplace_items.barcode), зафиксированный на заказе
-- в момент импорта заявки OZON FBO. Нужен для печати стикера FBO сшитого товара: связь
-- заказа с товаром по (material, width, height) неоднозначна, поэтому храним точный штрихкод
-- прямо в заказе.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_barcode VARCHAR(100);