-- Списание в ноль рулонов, которые больше месяца лежат в цехе без кроя
-- (по просьбе владельца, 13.10.2026). 17 рулонов, ~2 400 м ткани и пачка 1000 пакетов.
-- remaining_at_close не ставим: это не недостача сотрудниц, на дашборд недостач и в
-- штрафы списание не попадает. Сколько было на рулоне — пишем в журнал по каждому.
WITH tgt AS (
    SELECT r.id, r.barcode, r.remaining_quantity
      FROM rolls r
     WHERE r.status = 'in_workshop'
       AND r.removed_at IS NULL
       AND COALESCE(r.accepted_at, r.created_at) < now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM order_material_usage u
                        WHERE u.roll_id = r.id AND u.created_at >= now() - interval '30 days')
),
log AS (
    INSERT INTO audit_log (category, user_id, user_name, action, entity_type, entity_id, description)
    SELECT 'warehouse', NULL, 'Администратор', 'roll_write_off', 'roll', t.id,
           'Списан в ноль: больше месяца в цехе без кроя. Остаток был ' || round(t.remaining_quantity, 2)::text
      FROM tgt t
    RETURNING entity_id
)
UPDATE rolls r
   SET remaining_quantity = 0,
       status = 'completed',
       completed_at = now(),
       closed_by_name = 'Списание: месяц без кроя'
  FROM tgt
 WHERE r.id = tgt.id
   AND (SELECT count(*) FROM log) >= 0;