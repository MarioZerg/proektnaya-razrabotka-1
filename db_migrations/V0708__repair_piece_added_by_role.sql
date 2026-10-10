ALTER TABLE repair_fabric_pieces
    ADD COLUMN IF NOT EXISTS added_by_role VARCHAR(40);

UPDATE repair_fabric_pieces
SET added_by_role = 'packer'
WHERE added_by_role IS NULL;