-- Помечаем служебные заглушки, залитые при поиске предела размера запроса.
-- Они уже лежат на скрытом товаре «Проверка магазина» и в витрину не попадают,
-- но подписываем их явно, чтобы не спутать с настоящими сертификатами.
UPDATE variki_certificates
SET file_name = '[тест] ' || file_name
WHERE item_id = (SELECT id FROM variki_shop_items WHERE title = 'Проверка магазина')
  AND file_name NOT LIKE '[тест]%';
