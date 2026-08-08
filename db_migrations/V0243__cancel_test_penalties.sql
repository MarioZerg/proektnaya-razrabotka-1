-- Обнуляем штрафы «за опоздание», которые начислились на технических сменах при моей
-- проверке гостевого режима. Реальной работы за ними нет: смены длились меньше минуты
-- и были открыты/закрыты подряд запросами.
-- Записи не удаляем — обнуляем сумму и помечаем описание, чтобы история осталась.
UPDATE salary_accruals sa
SET amount = 0, description = 'Отменено: техническая проверка'
FROM shift_sessions ss
WHERE ss.id = sa.shift_session_id
  AND sa.type = 'penalty'
  AND sa.accrued_for = CURRENT_DATE
  AND sa.paid_at IS NULL
  AND ss.closed_at IS NOT NULL
  AND EXTRACT(EPOCH FROM (ss.closed_at - ss.opened_at)) < 60;