-- Отметка последней загрузки возвратов с маркетплейсов.
--
-- Страница возвратов теперь подтягивает новые заявки сама, без кнопки. Чтобы каждое
-- открытие страницы не дёргало OZON/WB/Яндекс и не жгло лимиты API, храним время
-- последней загрузки: если данные свежее 10 минут, фоновый запрос ничего не делает.
CREATE TABLE IF NOT EXISTS marketplace_returns_sync (
    id INTEGER PRIMARY KEY,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO marketplace_returns_sync (id, synced_at)
VALUES (1, now() - interval '1 hour')
ON CONFLICT (id) DO NOTHING;
