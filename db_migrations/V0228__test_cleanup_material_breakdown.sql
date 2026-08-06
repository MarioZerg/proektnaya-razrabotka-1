-- Убираем тестовые заказы проверки разбивки по материалам.
UPDATE orders SET status = 'Отменён' WHERE order_number LIKE 'MAT-TEST-%';