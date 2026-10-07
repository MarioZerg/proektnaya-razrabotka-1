INSERT INTO marketplace_integrations (marketplace_code, shop_id, is_enabled, credentials)
SELECT 'onec_buh', s.id, false, '{}'::jsonb
FROM shops s
WHERE s.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM marketplace_integrations mi
    WHERE mi.marketplace_code = 'onec_buh' AND mi.shop_id = s.id
  );