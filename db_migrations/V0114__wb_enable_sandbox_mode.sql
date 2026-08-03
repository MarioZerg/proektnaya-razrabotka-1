-- Тестовый API-ключ WB работает только на sandbox-контуре WB Marketplace API,
-- поэтому включаем режим песочницы для отладки FBS-интеграции. Флаг читается функцией
-- wb_fbs (credentials.useSandbox) и переключает базовый URL на marketplace-api-sandbox.
UPDATE marketplace_integrations
SET credentials = credentials || '{"useSandbox": true}'::jsonb, updated_at = now()
WHERE marketplace_code = 'wildberries';
