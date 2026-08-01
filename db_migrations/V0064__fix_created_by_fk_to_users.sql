ALTER TABLE shipments DROP CONSTRAINT shipments_created_by_fkey;
ALTER TABLE shipments ADD CONSTRAINT shipments_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
