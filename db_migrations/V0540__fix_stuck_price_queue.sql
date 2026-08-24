-- ЧИНИМ ЗАВИСШУЮ ОЧЕРЕДЬ ПОСЛЕ ТАЙМАУТА.
--
-- Ручной шаг +0.5% отправил 200 карточек на площадку, но вызов оборвался по
-- таймауту до записи прогресса: в очереди осталось 674 из 674. Следующий
-- заход поднял бы эти 200 второй раз.
--
-- Вычёркиваем из очереди всё, что уже стоит на «эталон 24 августа +0.5%» —
-- то есть уже сдвинуто. Останутся только те, кого шаг не коснулся.
UPDATE price_robot_pending p
SET remaining_ids = (
    SELECT coalesce(jsonb_agg(x.id), '[]'::jsonb)
    FROM (
        SELECT (value #>> '{}')::int AS id
        FROM jsonb_array_elements(p.remaining_ids)
    ) x
    JOIN marketplace_prices mp
      ON mp.marketplace_item_id = x.id AND mp.marketplace_code = 'ozon'
    JOIN price_history h
      ON h.marketplace_item_id = x.id AND h.marketplace_code = 'ozon'
     AND h.captured_on = '2026-08-24'
    WHERE h.price > 0
      AND abs(mp.price - round(h.price * 1.005, 2)) > 0.5
),
pushed = 200
WHERE p.marketplace_code = 'ozon';