-- Убираем служебную заглушку big.pdf, загруженную при поиске предела размера
-- запроса. Это не настоящий сертификат — выдать его сотруднику нельзя.
-- Переносим на скрытый служебный товар, чтобы он не попал в остаток витрины.
UPDATE variki_certificates
SET item_id = (SELECT id FROM variki_shop_items WHERE title = 'Проверка магазина'),
    file_name = '[тест] ' || file_name
WHERE file_name = 'big.pdf' AND purchase_id IS NULL;
