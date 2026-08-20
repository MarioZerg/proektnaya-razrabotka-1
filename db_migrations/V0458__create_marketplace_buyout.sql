-- Процент выкупа, посчитанный САМОЙ площадкой.
--
-- Раньше выкуп считался по нашим заказам: сколько отменили до отгрузки. Но это
-- лишь половина правды — покупатель может забрать вещь и вернуть её через две
-- недели, и такой возврат в наши отметки не попадает вовсе.
--
-- Разница огромная: по нашим данным OZON давал 90%, а по данным площадки —
-- 69%. Каждая третья вещь ехала обратно, а расчёт этого не видел и показывал
-- прибыль, которой нет.
CREATE TABLE IF NOT EXISTS marketplace_buyout (
    id SERIAL PRIMARY KEY,
    marketplace_code VARCHAR(30) NOT NULL,
    scheme VARCHAR(10) NOT NULL,
    -- Процент выкупа: сколько из отправленных вещей осталось у покупателей.
    percent NUMERIC(5,2),
    -- Из чего посчитан: видно, что цифра не с потолка.
    ordered_units INTEGER,
    delivered_units INTEGER,
    returned_units INTEGER,
    cancelled_units INTEGER,
    -- За какой период считали.
    period_days INTEGER,
    synced_at TIMESTAMP DEFAULT now(),
    UNIQUE (marketplace_code, scheme)
);

COMMENT ON TABLE marketplace_buyout IS
    'Процент выкупа по данным самой площадки — с учётом возвратов после доставки';
