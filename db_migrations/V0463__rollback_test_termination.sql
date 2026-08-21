-- Откат проверочного расторжения.
--
-- Заявление Короткова Кирилла создавалось при проверке механизма: человек
-- работает, доступ ему нужен. Возвращаем доступ и помечаем заявление
-- отменённым — запись остаётся в истории как след проверки, но силы не имеет.
UPDATE users SET contract_terminated_at = NULL WHERE id = 30;

UPDATE contract_terminations
SET status = 'cancelled',
    reject_reason = 'Проверка работы механизма, заявление недействительно'
WHERE user_id = 30;

UPDATE termination_sign_codes SET used_at = now()
WHERE used_at IS NULL
  AND termination_id IN (SELECT id FROM contract_terminations WHERE user_id = 30);
