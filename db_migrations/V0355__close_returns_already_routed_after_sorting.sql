-- Плашка «Непроверенные возвраты: 7 шт.» звала разбирать уже разобранное.
--
-- Кладовщик принял вещи и определил их судьбу: 6 уехали в цех на осмотр
-- (repacking), 1 ушла в подбор заказа (picking). Разбор окончен, дальше отвечают
-- упаковщицы. Но заявки возвратов оставались в статусе «Забран, ждёт разбора»,
-- и склад показывал плашку о непроверенных возвратах.
--
-- Закрываем заявки тех возвратов, чья вещь уже ушла дальше по маршруту.
-- outcome ставим по фактическому маршруту вещи:
--   repacking          — отправлена в цех на осмотр   -> 'repack'
--   picking / in_stock — лежит на складе/в подборе     -> 'stored'
--
-- Вещи, реально ждущие разбора (mp_return), не трогаем: по ним решение ещё
-- не принято, и плашка про них должна работать.

UPDATE marketplace_returns r
SET status = 'processed',
    outcome = COALESCE(
        r.outcome,
        CASE WHEN gw.status = 'repacking' THEN 'repack' ELSE 'stored' END
    )
FROM goods_warehouse gw
WHERE gw.id = r.goods_warehouse_id
  AND r.status = 'picked_up'
  AND gw.status IN ('repacking', 'picking', 'in_stock', 'inspected', 'taken');
