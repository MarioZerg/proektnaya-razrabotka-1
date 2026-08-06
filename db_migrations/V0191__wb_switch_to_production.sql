UPDATE marketplace_integrations
SET credentials = jsonb_set(credentials, '{useSandbox}', 'false'::jsonb),
    updated_at = now()
WHERE marketplace_code = 'wildberries';