ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS accountant_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS accountant_comment text,
  ADD COLUMN IF NOT EXISTS accountant_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS accountant_confirmed_by integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS onec_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS onec_error text;

ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_accountant_status_check;
ALTER TABLE shipments
  ADD CONSTRAINT shipments_accountant_status_check
  CHECK (accountant_status IN ('pending', 'confirmed', 'correction'));

CREATE INDEX IF NOT EXISTS idx_shipments_accountant_status
  ON shipments (accountant_status)
  WHERE type = 'from_supplier';

UPDATE shipments
SET accountant_status = 'confirmed'
WHERE type = 'from_supplier'
  AND status IN ('Завершено', 'Отклонена')
  AND accountant_confirmed_at IS NULL;

CREATE TABLE IF NOT EXISTS onec_outbox (
  id bigserial PRIMARY KEY,
  entity text NOT NULL,
  entity_id integer NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_onec_outbox_pending
  ON onec_outbox (id)
  WHERE status = 'pending';