INSERT INTO system_settings (key, value, updated_at)
SELECT 'fbo_dates_synced_at', '', now() - interval '1 day'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE key = 'fbo_dates_synced_at');