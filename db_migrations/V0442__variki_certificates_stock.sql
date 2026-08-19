-- СКЛАД СЕРТИФИКАТОВ.
--
-- Раньше сотрудник покупал и ЖДАЛ, пока админ вручную найдёт и пришлёт купон.
-- Теперь админ заранее загружает пачку готовых сертификатов, и покупка выдаёт
-- один из них мгновенно — ждать нечего.
--
-- Каждый файл — отдельная строка, а не счётчик: сертификаты именные/одноразовые,
-- и один и тот же PDF нельзя выдать двоим. Выданный помечается покупкой.
CREATE TABLE IF NOT EXISTS variki_certificates (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES variki_shop_items(id),
    file_url TEXT NOT NULL,
    file_name VARCHAR(300) NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT now(),
    uploaded_by INTEGER NULL,
    uploaded_by_name VARCHAR(200) NULL,
    -- Пока NULL — сертификат свободен и его можно выдать.
    purchase_id INTEGER NULL REFERENCES variki_purchases(id),
    issued_at TIMESTAMP NULL
);

COMMENT ON TABLE variki_certificates IS
 'Склад готовых сертификатов магазина вариков. Строка с purchase_id IS NULL — свободный сертификат, доступный к выдаче.';

CREATE INDEX IF NOT EXISTS idx_variki_certs_free
    ON variki_certificates(item_id) WHERE purchase_id IS NULL;

-- Ограничение количества продаж. Сотрудник должен видеть, сколько осталось:
-- «5 сертификатов» — это и есть весь запас, после него товар кончился.
ALTER TABLE variki_shop_items ADD COLUMN IF NOT EXISTS stock_limit INTEGER NULL;
COMMENT ON COLUMN variki_shop_items.stock_limit IS
 'Сколько всего сертификатов доступно. NULL — без ограничения.';
