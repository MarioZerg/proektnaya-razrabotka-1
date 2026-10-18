ALTER TABLE repair_fabric_pieces
  ADD COLUMN IF NOT EXISTS removal_reason varchar(40),
  ADD COLUMN IF NOT EXISTS removal_comment text,
  ADD COLUMN IF NOT EXISTS removal_requested_by integer,
  ADD COLUMN IF NOT EXISTS removal_requested_by_name varchar(255),
  ADD COLUMN IF NOT EXISTS removal_requested_at timestamp;

CREATE INDEX IF NOT EXISTS idx_repair_pieces_removal_request
  ON repair_fabric_pieces (removal_requested_at)
  WHERE removal_requested_at IS NOT NULL;