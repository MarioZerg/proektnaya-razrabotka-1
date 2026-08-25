-- Пустые карточки площадок для ДЮНЫ.
--
-- Без них экран интеграций для второго магазина был бы пустым: владельцу
-- некуда вписать ключи. Заводим выключенными — магазин начнёт работать только
-- после того, как ключи введут и включат вручную.
INSERT INTO marketplace_integrations (marketplace_code, is_enabled, credentials, shop_id)
SELECT mc.code, false, '{}'::jsonb, s.id
FROM shops s
CROSS JOIN (VALUES ('ozon'), ('wildberries'), ('yandex_market')) AS mc(code)
WHERE s.code = 'duna'
ON CONFLICT (shop_id, marketplace_code) DO NOTHING;