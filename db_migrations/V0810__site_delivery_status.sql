-- Статус посылки Ozon Доставки у заказов интернет-магазина (Rocket API):
-- Delivered, NotInDemand, Returning, ReturnReadyForSender, ReturnedToSender…
-- Пишется при открытии вкладки «мегатюль.рф» на странице «Коды для ПВЗ».
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status_at TIMESTAMP;

-- Карточка штрихкода «Ozon Доставка (мегатюль.рф)» из V0809 не нужна: у Ozon
-- Доставки нет штрихкода для ПВЗ — возвраты выдают на складе возврата по
-- документу. Её заменяет блок возвратов сайта. Убираем, только если код так и
-- не вписали.
DELETE FROM return_pickup_codes
WHERE marketplace_code = 'ozon' AND COALESCE(code, '') = ''
  AND shop_id = (SELECT id FROM shops WHERE code = 'megatul_site');
