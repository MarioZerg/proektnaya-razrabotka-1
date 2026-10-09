-- Шляпы на пузырьках сотрудников смены: колонка на пользователе и лут покупки.
-- Товар «Кейс бокс» безлимитный, без срока: каждая покупка даёт новую шляпу
-- и заменяет предыдущую.

ALTER TABLE users ADD COLUMN IF NOT EXISTS bubble_hat VARCHAR(40) NULL;

COMMENT ON COLUMN users.bubble_hat IS
 'Аксессуар на пузырьке сотрудника смены (ТВ). Новая покупка кейса заменяет старый.';

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
    'Открой кейс — на пузырьке сотрудника смены выпадет случайная смешная шляпа. Купил новый кейс — старая шляпа пропадает.',
    100,
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
