-- Возвращаем рулонам метраж перенесённых кусков.
--
-- ЗАЧЕМ. Кусок, «распущенный» в рулон, прибавлял свой метраж к остатку.
-- Теперь этот же кусок переехал в склад перешива и существует отдельно —
-- если не вычесть метраж обратно, один и тот же материал будет числиться
-- дважды: и в остатке рулона, и куском в цехе.
--
-- Метраж куска считался как ширина в сантиметрах / 100 (погонные метры).
-- Вычитаем ровно столько же и уменьшаем счётчик возвращённого упаковщицами.
--
-- Уходить в минус не даём: если рулон уже израсходован, остаток остаётся
-- нулевым, а не отрицательным.
WITH moved AS (
    SELECT
        r.id AS roll_id,
        SUM(p.width::numeric / 100) AS meters
    FROM repair_fabric_pieces p
    JOIN rolls r ON r.barcode = replace(p.comment, 'Перенесено из рулона ', '')
    WHERE p.comment LIKE 'Перенесено из рулона %'
      AND r.status IN ('in_workshop', 'in_storage')
    GROUP BY r.id
)
UPDATE rolls r
SET remaining_quantity = GREATEST(0, r.remaining_quantity - moved.meters),
    packer_returned_quantity = GREATEST(0, COALESCE(r.packer_returned_quantity, 0) - moved.meters)
FROM moved
WHERE r.id = moved.roll_id;
