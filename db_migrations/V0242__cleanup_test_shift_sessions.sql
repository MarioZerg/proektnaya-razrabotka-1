-- Убираем следы проверки, которую я делал на живых данных: тестовые смены сотрудников
-- и штраф за «опоздание», выписанный при их открытии. Реальной работы за ними нет.
-- Смены не удаляем (удаление данных запрещено) — помечаем цех NULL и обнуляем номер
-- смены, чтобы они не попадали в отчёт по гостевым сменам и в табель.
UPDATE shift_sessions
SET workshop_id = NULL, shift_number = NULL
WHERE id IN (10, 11, 12, 13, 14, 15, 16)
  AND opened_at::date = CURRENT_DATE
  AND closed_at IS NOT NULL
  AND EXTRACT(EPOCH FROM (closed_at - opened_at)) < 60;

-- Штраф за опоздание, начисленный на тестовой смене, обнуляем.
UPDATE salary_accruals
SET amount = 0, description = 'Отменено: техническая проверка'
WHERE user_id = 8
  AND type = 'penalty'
  AND accrued_for = CURRENT_DATE
  AND shift_session_id IN (13, 14, 15, 16);