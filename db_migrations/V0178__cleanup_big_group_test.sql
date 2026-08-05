-- Проверка пройдена полностью: закройщик получил связку из 32 вещей целиком при стеке 20,
-- раскроил её одной кнопкой (порциями, незаметно для него), швея забрала все 32 вещи одним
-- нажатием за 0.8 секунды. Убираем тестовую связку и возвращаем рулон к реальному остатку.
UPDATE orders SET status = 'Отменён', sewing_status = 'Отменён', assigned_user_id = NULL
WHERE group_key = 'YM-444444';

-- Возвращаем рулон: тестовое пополнение и списания на тестовую связку убираем.
UPDATE rolls SET remaining_quantity = 2.62 WHERE id = 17;

UPDATE order_material_usage SET quantity = 0
WHERE order_id IN (SELECT id FROM orders WHERE group_key = 'YM-444444');

UPDATE salary_accruals SET amount = 0, description = description || ' (тестовая связка, снято)'
WHERE order_id IN (SELECT id FROM orders WHERE group_key = 'YM-444444') AND amount > 0;
