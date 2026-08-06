-- Ставим интеграции маркетплейсов на паузу перед очисткой системы: новые заказы
-- перестают заливаться, чтобы не смешаться со старыми данными во время переноса.
-- Ключи доступа сохраняются — после переноса достаточно снова включить интеграции.
UPDATE marketplace_integrations
SET is_enabled = false, updated_at = now()
WHERE marketplace_code IN ('wildberries', 'ozon', 'yandex_market');