-- Поля для генерации собственного упаковочного листа Газельки (штрихкод Code128).
-- В штрихкоде Газельки есть IDS (id склада поставки) и IDM, которых нет в их API —
-- вводятся вручную на поставке. По умолчанию 0.
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS gazelka_ids INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS gazelka_idm INTEGER NOT NULL DEFAULT 0;

-- Реквизиты клиента (организации-отправителя) для упаковочного листа — общие для всех поставок.
INSERT INTO system_settings (key, value) VALUES
  ('gazelka_client_name', ''),
  ('gazelka_client_phone', '')
ON CONFLICT (key) DO NOTHING;
