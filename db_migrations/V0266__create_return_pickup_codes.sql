-- Штрихкоды продавца для получения возвратов в пунктах выдачи.
--
-- Чтобы забрать возвраты на ПВЗ, кладовщик показывает штрихкод кабинета продавца —
-- у каждого маркетплейса он свой и постоянный. Без него возвраты не отдают, поэтому
-- код должен быть под рукой прямо в телефоне, а не в бумажке или чужой переписке.
CREATE TABLE IF NOT EXISTS t_p86119184_proektnaya_razrabotk.return_pickup_codes (
    id SERIAL PRIMARY KEY,
    -- Код маркетплейса: ozon, wildberries, yandex_market и т.д.
    marketplace_code VARCHAR(30) NOT NULL UNIQUE,
    -- Отображаемое название, чтобы не переводить коды в интерфейсе.
    title VARCHAR(100) NOT NULL,
    -- Значение штрихкода, которое сканируют на ПВЗ.
    code VARCHAR(100),
    -- Формат штрихкода: обычно CODE128, у некоторых площадок QR.
    code_type VARCHAR(20) NOT NULL DEFAULT 'CODE128',
    comment TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by INTEGER REFERENCES t_p86119184_proektnaya_razrabotk.users(id)
);

-- Заводим строки для площадок, с которыми уже работаем: администратору останется
-- только вписать значения кодов из личных кабинетов.
INSERT INTO t_p86119184_proektnaya_razrabotk.return_pickup_codes (marketplace_code, title)
VALUES
    ('ozon', 'OZON'),
    ('wildberries', 'Wildberries'),
    ('yandex_market', 'Яндекс Маркет')
ON CONFLICT (marketplace_code) DO NOTHING;
