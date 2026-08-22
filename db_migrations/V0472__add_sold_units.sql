-- Штуки, проданные по факту получения денег, — рядом с рекламными цифрами.
--
-- Зачем. Себестоимость делит оклады и прочие постоянные расходы на количество
-- проданных вещей. Считать это количество по нашим заказам оказалось нельзя:
-- в системе живут только FBS-отправления, а FBO-продажи (товар лежит на складе
-- OZON и уходит покупателю без нашего участия) в заказы не попадают вовсе —
-- под видом FBO там заявки на поставку и оформленные возвраты.
--
-- Честный источник один: финансовые операции площадки. В операции «Доставка
-- покупателю» видно и схему (FBO или FBS), и состав отправления, и деньги —
-- то есть ровно то, за что мы получили оплату.
--
-- Пишем сюда штуки в момент синхронизации рекламы: она и так ходит за теми же
-- операциями, второй поход к площадке не нужен.
ALTER TABLE marketplace_ad_spend
    ADD COLUMN IF NOT EXISTS sold_units INTEGER,
    ADD COLUMN IF NOT EXISTS sold_units_fbo INTEGER,
    ADD COLUMN IF NOT EXISTS sold_units_fbs INTEGER;

ALTER TABLE marketplace_ad_monthly
    ADD COLUMN IF NOT EXISTS sold_units INTEGER,
    ADD COLUMN IF NOT EXISTS sold_units_fbo INTEGER,
    ADD COLUMN IF NOT EXISTS sold_units_fbs INTEGER;

COMMENT ON COLUMN marketplace_ad_spend.sold_units IS
    'Штук продано за период по данным площадки: FBO + FBS минус возвраты';
COMMENT ON COLUMN marketplace_ad_monthly.sold_units IS
    'Штук продано за месяц по данным площадки: FBO + FBS минус возвраты';
