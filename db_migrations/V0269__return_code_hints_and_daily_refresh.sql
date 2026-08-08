-- Подсказки, где брать код, и признак ежедневного обновления.
--
-- Выяснилось, что у OZON штрихкод для получения возвратов не постоянный: он привязан
-- к продавцу, но обновляется раз в сутки. Со вчерашним кодом возвраты на ПВЗ не выдадут.
-- Поэтому по таким площадкам показываем, когда код обновляли, и предупреждаем, если он
-- устарел. У WB и Яндекса код постоянный — их не тревожим.
ALTER TABLE t_p86119184_proektnaya_razrabotk.return_pickup_codes
    ADD COLUMN IF NOT EXISTS hint TEXT;

ALTER TABLE t_p86119184_proektnaya_razrabotk.return_pickup_codes
    ADD COLUMN IF NOT EXISTS daily_refresh BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.return_pickup_codes.daily_refresh IS
    'Код обновляется раз в сутки — устаревший на ПВЗ не примут';

UPDATE t_p86119184_proektnaya_razrabotk.return_pickup_codes
SET hint = 'Личный кабинет Ozon Seller → раздел «Возвраты» → блок «Штрихкод для получения». '
           'Код обновляется раз в сутки: перед поездкой на ПВЗ скопируйте свежий.',
    daily_refresh = true
WHERE marketplace_code = 'ozon';

UPDATE t_p86119184_proektnaya_razrabotk.return_pickup_codes
SET hint = 'Личный кабинет WB Партнёры → раздел «Возвраты» → штрихкод продавца для получения '
           'возвратов на пункте выдачи.'
WHERE marketplace_code = 'wildberries';

UPDATE t_p86119184_proektnaya_razrabotk.return_pickup_codes
SET hint = 'Личный кабинет Яндекс Маркета → «Возвраты и невыкупы» → код для получения '
           'возвратов в пункте выдачи.'
WHERE marketplace_code = 'yandex_market';
