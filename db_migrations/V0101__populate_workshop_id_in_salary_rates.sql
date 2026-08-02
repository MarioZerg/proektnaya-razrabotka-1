DROP INDEX idx_salary_rates_unique;

UPDATE salary_rates SET workshop_id = (SELECT id FROM workshops ORDER BY id LIMIT 1) WHERE workshop_id IS NULL;

INSERT INTO salary_rates (role, material_id, width, rate, workshop_id)
SELECT sr.role, sr.material_id, sr.width, sr.rate, w.id
FROM salary_rates sr
CROSS JOIN workshops w
WHERE sr.workshop_id = (SELECT id FROM workshops ORDER BY id LIMIT 1)
  AND w.id != (SELECT id FROM workshops ORDER BY id LIMIT 1);

ALTER TABLE salary_rates ALTER COLUMN workshop_id SET NOT NULL;

CREATE UNIQUE INDEX idx_salary_rates_unique ON salary_rates (
    workshop_id,
    role,
    COALESCE(material_id, 0),
    COALESCE(width, 0)
);

CREATE INDEX idx_salary_rates_workshop ON salary_rates(workshop_id);