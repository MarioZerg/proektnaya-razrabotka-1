-- Временная позиция за 1 варик для проверки цикла покупки (покупка → купон →
-- возврат). Сразу выключена: в витрине не показывается, на балансы не влияет.
INSERT INTO variki_shop_items (title, description, price, animation, icon, is_active, sort_order)
SELECT 'Проверка магазина', 'Служебная позиция для проверки механизма.', 1, 'spa', 'Bug', false, 99
WHERE NOT EXISTS (SELECT 1 FROM variki_shop_items WHERE title = 'Проверка магазина');
