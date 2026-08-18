-- Стартовые тарифы WB и Яндекса: их API комиссию по товару не отдаёт, а без неё
-- расчёт прибыли невозможен. Ставим ориентировочные значения по категории
-- «Дом / шторы», чтобы вкладки заработали сразу. Менеджер сверит их со своим
-- кабинетом и поправит — поля редактируемые.
UPDATE marketplace_tariffs
SET commission_fbs_percent = 24.5,
    commission_fbo_percent = 21.5,
    logistics_fbs = 100,
    logistics_fbo = 85,
    return_logistics = 50,
    acquiring_percent = 0
WHERE marketplace_code = 'wildberries'
  AND commission_fbs_percent = 0;

UPDATE marketplace_tariffs
SET commission_fbs_percent = 15,
    commission_fbo_percent = 13,
    logistics_fbs = 90,
    logistics_fbo = 80,
    return_logistics = 50,
    acquiring_percent = 1.3
WHERE marketplace_code = 'yandex_market'
  AND commission_fbs_percent = 0;