-- Возвращаем в общую очередь заказы, взятые на швею при повторной проверке перехода
-- между цехами. Реальной работы по ним не было.
UPDATE orders
SET sewing_status = 'Новый', assigned_user_id = NULL, taken_at = NULL
WHERE id IN (54, 55, 944, 963, 977, 1074, 1076)
  AND assigned_user_id = 3
  AND sewing_status = 'На раскрое';

-- Обнуляем штраф за «опоздание», начисленный на технической смене этой проверки.
UPDATE salary_accruals sa
SET amount = 0, description = 'Отменено: техническая проверка'
FROM shift_sessions ss
WHERE ss.id = sa.shift_session_id
  AND sa.user_id = 3
  AND sa.type = 'penalty'
  AND sa.accrued_for = CURRENT_DATE
  AND sa.paid_at IS NULL;