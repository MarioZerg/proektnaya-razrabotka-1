INSERT INTO t_p86119184_proektnaya_razrabotk.salary_accruals (user_id, type, amount, description, accrued_for)
SELECT a.user_id, 'packer_repack', 20.00,
       'Перепаковка возврата ' || g.storage_barcode || ' (повторный возврат, доначислено)',
       (a.created_at + interval '3 hours')::date
FROM t_p86119184_proektnaya_razrabotk.audit_log a
JOIN t_p86119184_proektnaya_razrabotk.goods_warehouse g ON g.id = a.entity_id
WHERE a.action = 'repack_done' AND a.user_id = 51
  AND a.created_at > now() - interval '30 days'
  AND a.description NOT LIKE '%утилиз%'
  AND EXISTS (SELECT 1 FROM t_p86119184_proektnaya_razrabotk.salary_accruals s
              WHERE s.type = 'packer_repack' AND s.order_id = g.order_id
                AND s.created_at < a.created_at - interval '5 seconds')
  AND NOT EXISTS (SELECT 1 FROM t_p86119184_proektnaya_razrabotk.salary_accruals s
                  WHERE s.type = 'packer_repack' AND s.user_id = a.user_id
                    AND abs(extract(epoch FROM s.created_at - a.created_at)) < 5)
  AND NOT EXISTS (SELECT 1 FROM t_p86119184_proektnaya_razrabotk.salary_accruals s
                  WHERE s.type = 'packer_repack' AND s.user_id = a.user_id
                    AND s.description = 'Перепаковка возврата ' || g.storage_barcode || ' (повторный возврат, доначислено)');