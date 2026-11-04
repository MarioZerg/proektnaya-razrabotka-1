UPDATE t_p86119184_proektnaya_razrabotk.system_settings
SET value = '["Шифон"]', updated_at = now()
WHERE key = 'cut_paused_products'
  AND value LIKE '%Шифон%';