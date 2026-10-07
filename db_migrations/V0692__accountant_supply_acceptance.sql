-- Приёмка от поставщика: бухгалтер сверяет лист кладовщика и только потом
-- документ уходит в 1С. Очередь обмена — поставщики, сотрудники, материалы,
-- начисления и остатки склада.

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

-- Старые приёмки уже на складе: в очередь сверки их не кладём,
-- иначе бухгалтеру придётся подтверждать всю историю. В 1С они
-- не уйдут автоматически — только новые после запуска процесса.
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

-- Справочники и начисления кладём в очередь сами: точек записи много,
-- а выгрузка в 1С должна быть одна и та же.

CREATE OR REPLACE FUNCTION enqueue_onec_row(p_entity text, p_entity_id integer, p_payload jsonb)
RETURNS void AS $$
BEGIN
  INSERT INTO onec_outbox (entity, entity_id, payload)
  VALUES (p_entity, p_entity_id, COALESCE(p_payload, '{}'::jsonb));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_onec_supplier()
RETURNS trigger AS $$
BEGIN
  PERFORM enqueue_onec_row('supplier', NEW.id, jsonb_build_object(
    'id', NEW.id,
    'name', NEW.name,
    'phone', NEW.phone,
    'address', NEW.address,
    'comment', NEW.comment,
    'currency', NEW.currency
  ));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_onec_supplier_ins ON suppliers;
CREATE TRIGGER trg_onec_supplier_ins
  AFTER INSERT ON suppliers
  FOR EACH ROW EXECUTE PROCEDURE trg_onec_supplier();

DROP TRIGGER IF EXISTS trg_onec_supplier_upd ON suppliers;
CREATE TRIGGER trg_onec_supplier_upd
  AFTER UPDATE OF name, phone, address, comment, currency ON suppliers
  FOR EACH ROW EXECUTE PROCEDURE trg_onec_supplier();

CREATE OR REPLACE FUNCTION trg_onec_employee()
RETURNS trigger AS $$
BEGIN
  PERFORM enqueue_onec_row('employee', NEW.id, jsonb_build_object(
    'id', NEW.id,
    'fullName', NEW.full_name,
    'email', NEW.email,
    'phone', NEW.phone,
    'role', NEW.role,
    'login', NEW.login,
    'workshop', NEW.workshop,
    'salary', NEW.salary
  ));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_onec_employee_ins ON users;
CREATE TRIGGER trg_onec_employee_ins
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE PROCEDURE trg_onec_employee();

DROP TRIGGER IF EXISTS trg_onec_employee_upd ON users;
CREATE TRIGGER trg_onec_employee_upd
  AFTER UPDATE OF full_name, email, phone, role, workshop, salary ON users
  FOR EACH ROW EXECUTE PROCEDURE trg_onec_employee();

CREATE OR REPLACE FUNCTION trg_onec_material()
RETURNS trigger AS $$
DECLARE
  type_name text;
BEGIN
  SELECT name INTO type_name FROM material_types WHERE id = NEW.type_id;
  PERFORM enqueue_onec_row('material', NEW.id, jsonb_build_object(
    'id', NEW.id,
    'name', NEW.name,
    'unit', NEW.unit,
    'status', NEW.status,
    'typeId', NEW.type_id,
    'typeName', type_name
  ));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_onec_material_ins ON materials;
CREATE TRIGGER trg_onec_material_ins
  AFTER INSERT ON materials
  FOR EACH ROW EXECUTE PROCEDURE trg_onec_material();

DROP TRIGGER IF EXISTS trg_onec_material_upd ON materials;
CREATE TRIGGER trg_onec_material_upd
  AFTER UPDATE OF name, unit, status, type_id ON materials
  FOR EACH ROW EXECUTE PROCEDURE trg_onec_material();

CREATE OR REPLACE FUNCTION trg_onec_salary_accrual()
RETURNS trigger AS $$
DECLARE
  emp_name text;
BEGIN
  SELECT full_name INTO emp_name FROM users WHERE id = NEW.user_id;
  PERFORM enqueue_onec_row('salary_accrual', NEW.id, jsonb_build_object(
    'id', NEW.id,
    'userId', NEW.user_id,
    'fullName', emp_name,
    'type', NEW.type,
    'amount', NEW.amount,
    'description', NEW.description,
    'accruedFor', NEW.accrued_for,
    'orderId', NEW.order_id
  ));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_onec_salary_accrual_ins ON salary_accruals;
CREATE TRIGGER trg_onec_salary_accrual_ins
  AFTER INSERT ON salary_accruals
  FOR EACH ROW EXECUTE PROCEDURE trg_onec_salary_accrual();
