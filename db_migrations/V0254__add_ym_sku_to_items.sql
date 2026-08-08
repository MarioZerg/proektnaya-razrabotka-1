-- Артикул товара в Яндекс Маркете.
--
-- У Ozon и Wildberries свои артикулы уже есть (ozon_sku, wb_sku), а у Яндекса не было:
-- заказы искали товар только по общему артикулу продавца. Если в кабинете Яндекса
-- артикул отличался хоть символом, вещь не вставала на конвейер и заказ терялся.
ALTER TABLE t_p86119184_proektnaya_razrabotk.marketplace_items
    ADD COLUMN IF NOT EXISTS ym_sku VARCHAR(100);

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.marketplace_items.ym_sku IS
    'Артикул товара в Яндекс Маркете (offerId/shopSku). Пусто — ищем по общему артикулу и штрихкоду';
