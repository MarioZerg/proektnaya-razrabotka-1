-- Чистый сброс связки перед повторной проверкой отката (hanger_number не обнуляем — поле
-- обязательное).
UPDATE orders SET sewing_status = 'На раскрое', cut_at = NULL
WHERE group_key = 'YM-444444';
