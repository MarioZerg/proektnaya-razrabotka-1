-- Штрихкод получения возвратов Ozon Доставки для мегатюль.рф.
--
-- У Ozon Доставки для интернет-магазинов свой штрихкод возвратов (Ozon Delivery
-- API: /v1/return/reset_barcode). Его выпускает кнопка «Обновить код» на
-- вкладке «мегатюль.рф» страницы «Коды для ПВЗ», вписывать руками не нужно.
INSERT INTO return_pickup_codes (marketplace_code, title, code_type, daily_refresh, shop_id)
SELECT 'ozon_delivery', 'Ozon Доставка', 'CODE128', false, s.id
FROM shops s
WHERE s.code = 'megatul_site'
  AND NOT EXISTS (
    SELECT 1 FROM return_pickup_codes x WHERE x.shop_id = s.id AND x.marketplace_code = 'ozon_delivery'
  );
