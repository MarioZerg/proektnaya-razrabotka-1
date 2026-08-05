-- Для проверки успешного раскроя связки из 32 вещей нужен рулон с запасом: одной вещи нужно
-- ~3 пог.м., значит на всю связку около 100. Пополняем рулон вуали в цехе №1.
UPDATE rolls SET remaining_quantity = 120, status = 'in_workshop', completed_at = NULL
WHERE id = 17;
