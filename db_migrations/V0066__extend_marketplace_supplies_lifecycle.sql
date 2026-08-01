ALTER TABLE marketplace_supplies
  ADD COLUMN IF NOT EXISTS supply_number varchar(50) NULL,
  ADD COLUMN IF NOT EXISTS supply_barcode varchar(50) NULL,
  ADD COLUMN IF NOT EXISTS cluster varchar(150) NULL,
  ADD COLUMN IF NOT EXISTS gazelka_id varchar(50) NULL,
  ADD COLUMN IF NOT EXISTS ship_to_gazelka_at timestamp NULL,
  ADD COLUMN IF NOT EXISTS ship_to_marketplace_at timestamp NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamp NULL,
  ADD COLUMN IF NOT EXISTS created_by integer NULL REFERENCES users(id);

ALTER TABLE marketplace_supplies ALTER COLUMN status SET DEFAULT 'Открытая';
