-- Код ПВЗ для возвратов интернет-магазина мегатюль.рф.
--
-- Магазин сайта завели позже V0630, и своих строк кодов у него не было: на
-- вкладке «мегатюль.рф» нечего было показать и некуда вписать код, а на ПВЗ
-- ездили с общим кодом кабинета МЕГАТЮЛЬ. Посылки сайта идут через Ozon
-- Доставку от имени магазина сайта — забирать их нужно по его собственному
-- штрихкоду. Ключей Ozon у сайта в CRM нет, поэтому код вписывает
-- администратор (кнопка карандаша), автообновления нет.
INSERT INTO return_pickup_codes (marketplace_code, title, code_type, daily_refresh, shop_id)
SELECT 'ozon', 'Ozon Доставка (мегатюль.рф)', 'CODE128', false, s.id
FROM shops s
WHERE s.code = 'megatul_site'
  AND NOT EXISTS (
    SELECT 1 FROM return_pickup_codes x WHERE x.shop_id = s.id AND x.marketplace_code = 'ozon'
  );
