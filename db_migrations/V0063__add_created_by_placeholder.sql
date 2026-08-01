ALTER TABLE shipments ADD COLUMN IF NOT EXISTS created_by integer NULL REFERENCES workshops(id);
