-- Шляпы на пузырьках только после покупки кейса. 30 дней — 3 заказа вместо 2.

ALTER TABLE users ADD COLUMN IF NOT EXISTS bubble_hat VARCHAR(40) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hat_boost_until TIMESTAMPTZ NULL;

COMMENT ON COLUMN users.bubble_hat IS
 'Шляпа на пузырьке сотрудника смены. Появляется только после покупки кейс бокса.';
COMMENT ON COLUMN users.hat_boost_until IS
 'До этой отметки швея может держать 3 заказа вместо 2. Каждая покупка кейса обновляет срок на 30 дней.';

ALTER TABLE variki_purchases ADD COLUMN IF NOT EXISTS loot_key VARCHAR(40) NULL;
ALTER TABLE variki_purchases ADD COLUMN IF NOT EXISTS loot_title VARCHAR(200) NULL;

COMMENT ON COLUMN variki_purchases.loot_key IS
 'Ключ выпавшего аксессуара из кейс бокса.';
COMMENT ON COLUMN variki_purchases.loot_title IS
 'Название выпавшего аксессуара, как видит сотрудник.';

INSERT INTO variki_shop_items (
    title, description, price, animation, icon,
    stock_limit, valid_from, valid_to, needs_visit_date,
    is_active, sort_order
)
SELECT
    'Кейс бокс',
    'Преимущество шляпы: 30 дней вы держите в работе 3 заказа вместо обычных 2 — можно шить больше за смену. На пузырьке сотрудника смены появляется случайная шляпа. Купили снова — старая шляпа пропадает, таймер усиления стартует заново на 30 дней.',
    15000,
    'bubble_case',
    'Package',
    NULL,
    NULL,
    NULL,
    false,
    true,
    0
WHERE NOT EXISTS (
    SELECT 1 FROM variki_shop_items WHERE animation = 'bubble_case'
);

UPDATE variki_shop_items
SET title = 'Кейс бокс',
    description = 'Преимущество шляпы: 30 дней вы держите в работе 3 заказа вместо обычных 2 — можно шить больше за смену. На пузырьке сотрудника смены появляется случайная шляпа. Купили снова — старая шляпа пропадает, таймер усиления стартует заново на 30 дней.',
    price = 15000,
    is_active = true,
    stock_limit = NULL,
    valid_from = NULL,
    valid_to = NULL,
    needs_visit_date = false
WHERE animation = 'bubble_case';
