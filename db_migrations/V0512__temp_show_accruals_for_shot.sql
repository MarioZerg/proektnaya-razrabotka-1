-- Показываем начисления, чтобы посмотреть, как выглядит анализ маржи.
--
-- Снимаем отметку об аннулировании с пробных недель: нужно увидеть карточки
-- с меткой площадки и средней маржой. Вернём сразу после снимка.
UPDATE manager_accruals
SET status = 'confirmed', cancelled_at = NULL, cancel_reason = NULL
WHERE user_id = 32 AND period_start < DATE '2026-08-24';
