-- Вещи, которые «положили на полку», хотя их туда не клали.
--
-- Причина: при сканировании клиентского стикера система принимала СРАЗУ ВСЕ вещи
-- отправления. Кладовщик сканировал один пакет, а зачислялись и остальные — их он
-- ещё даже не достал. При скане второго пакета сканер отвечал «уже принята», и
-- вещь физически оставалась неразобранной, числясь лежащей на полке.
--
-- Особенно незаметно это с одинаковыми размерами: две штуки «Шифон 400x270» с
-- разными стикерами выглядят одинаково, но это РАЗНЫЕ вещи.
--
-- Возвращаем в разбор те вещи, что попали на полку пачкой: они делят номер
-- отправления с другой вещью и были уложены одной операцией (одинаковый
-- received_at). Кладовщик разберёт их заново — теперь по одной за скан.
--
-- Вещи из отправлений с единственным возвратом не трогаем: их принимали штучно,
-- и они действительно лежат на полке.

WITH multi AS (
    SELECT r.goods_warehouse_id
    FROM marketplace_returns r
    WHERE r.posting_number IN (
        SELECT posting_number
        FROM marketplace_returns
        WHERE posting_number IS NOT NULL
        GROUP BY posting_number
        HAVING count(*) > 1
    )
)
UPDATE goods_warehouse gw
SET status = 'mp_return',
    shelf_id = NULL
WHERE gw.id IN (SELECT goods_warehouse_id FROM multi)
  AND gw.status = 'in_stock'
  AND gw.receive_reason = 'return';

-- Заявки этих возвратов снова ждут разбора.
UPDATE marketplace_returns r
SET status = 'picked_up',
    outcome = NULL
FROM goods_warehouse gw
WHERE gw.id = r.goods_warehouse_id
  AND gw.status = 'mp_return'
  AND r.status = 'processed';
