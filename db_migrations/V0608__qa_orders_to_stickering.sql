-- Тестовые заказы на стикеровке — для прогона терминала упаковщицы.
-- Один обычный, второй под проверку двойного закрытия.
UPDATE orders SET sewing_status = 'Стикеровка', sewn_at = now()
WHERE order_number IN ('QA-TEST-ORD-1', 'QA-TEST-ORD-2');
