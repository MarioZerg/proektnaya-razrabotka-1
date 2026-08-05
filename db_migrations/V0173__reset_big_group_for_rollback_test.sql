-- Возвращаем связку из 32 вещей в «На раскрое», чтобы проверить откат заново: предыдущая
-- попытка успела раскроить 21 вещь до того, как появился rollback. Списанный при этом
-- материал возвращаем в рулон, чтобы проверка была честной.
UPDATE rolls r
SET remaining_quantity = r.remaining_quantity + sub.qty, status = 'in_workshop', completed_at = NULL
FROM (
    SELECT omu.roll_id, sum(omu.quantity) AS qty
    FROM order_material_usage omu
    JOIN orders o ON o.id = omu.order_id
    WHERE o.group_key = 'YM-444444'
    GROUP BY omu.roll_id
) sub
WHERE r.id = sub.roll_id;

-- Обнуляем следы попытки: расход помечаем нулевым, начисления закройщику снимаем.
UPDATE order_material_usage SET quantity = 0
WHERE order_id IN (SELECT id FROM orders WHERE group_key = 'YM-444444');

UPDATE salary_accruals SET amount = 0, description = description || ' (откат теста)'
WHERE order_id IN (SELECT id FROM orders WHERE group_key = 'YM-444444');

UPDATE orders SET sewing_status = 'На раскрое', cut_at = NULL WHERE group_key = 'YM-444444';
