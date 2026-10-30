UPDATE t_p86119184_proektnaya_razrabotk.goods_warehouse
SET status = 'returned_to_roll', shipped_at = COALESCE(shipped_at, now()),
    returned_to_roll_at = COALESCE(returned_to_roll_at, now())
WHERE id IN (21171, 17800) AND status = 'repacking';