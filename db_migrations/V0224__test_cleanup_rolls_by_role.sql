-- Выводим из оборота тестовые рулоны проверки фильтрации по ролям.
UPDATE rolls SET status = 'completed', remaining_quantity = 0, completed_at = now()
WHERE barcode LIKE 'TESTROLL-%';