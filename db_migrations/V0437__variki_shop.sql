-- МАГАЗИН ВАРИКОВ.
-- Сотрудник тратит накопленную игровую валюту на реальные подарки. Купон admin
-- прикрепляет вручную PDF-файлом: сертификаты покупаются на стороне и приходят
-- письмом, автоматизировать выдачу нечем.

CREATE TABLE IF NOT EXISTS variki_shop_items (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT NULL,
    price INTEGER NOT NULL,
    -- Ключ анимации на карточке: подобраны под тип подарка (spa — гидромассаж).
    animation VARCHAR(50) NOT NULL DEFAULT 'spa',
    icon VARCHAR(50) NOT NULL DEFAULT 'Gift',
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

COMMENT ON TABLE variki_shop_items IS
 'Витрина магазина вариков: что сотрудник может купить за игровую валюту.';

CREATE TABLE IF NOT EXISTS variki_purchases (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES variki_shop_items(id),
    user_id INTEGER NOT NULL,
    user_name VARCHAR(200) NULL,
    -- Цена фиксируется в момент покупки: цена в витрине может измениться позже,
    -- а списали с сотрудника именно столько.
    price INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    -- Купон, который админ прикрепляет после покупки.
    coupon_url TEXT NULL,
    coupon_name VARCHAR(300) NULL,
    coupon_at TIMESTAMP NULL,
    coupon_by INTEGER NULL,
    coupon_by_name VARCHAR(200) NULL,
    -- Возврат вариков, если подарок выдать не удалось.
    cancel_reason TEXT NULL
);

COMMENT ON TABLE variki_purchases IS
 'Покупки за варики. pending — куплено, админ ещё не прикрепил купон; issued — купон загружен и виден сотруднику; cancelled — покупка отменена, варики возвращены.';

CREATE INDEX IF NOT EXISTS idx_variki_purchases_user ON variki_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_variki_purchases_status ON variki_purchases(status);

INSERT INTO variki_shop_items (title, description, price, animation, icon, sort_order)
SELECT 'Сертификат на гидромассаж',
       'Сеанс гидромассажа в спа-салоне. После покупки администратор пришлёт купон — покажете его в салоне.',
       8000, 'spa', 'Waves', 1
WHERE NOT EXISTS (SELECT 1 FROM variki_shop_items WHERE title = 'Сертификат на гидромассаж');
