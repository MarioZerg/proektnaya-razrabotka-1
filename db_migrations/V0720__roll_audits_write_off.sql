-- Админ может убрать из учёта рулоны, не найденные в сверке, и скрыть саму сверку.
ALTER TABLE roll_audits ADD COLUMN IF NOT EXISTS written_off_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE roll_audits ADD COLUMN IF NOT EXISTS written_off_at TIMESTAMP NULL;
ALTER TABLE roll_audits ADD COLUMN IF NOT EXISTS written_off_by_name VARCHAR(200) NULL;
ALTER TABLE roll_audits ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP NULL;
ALTER TABLE roll_audits ADD COLUMN IF NOT EXISTS hidden_by_name VARCHAR(200) NULL;