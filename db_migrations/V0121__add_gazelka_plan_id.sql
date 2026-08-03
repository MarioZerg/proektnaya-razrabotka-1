-- Привязка нашей поставки к заявке грузоперевозки Gazelka (gazelka.space).
-- gazelka_plan_id — id заявки (plan) в Газельке, выбранной менеджером вручную.
-- Стикеры коробов печатаются в ЛК Газельки: https://gazelka.space/print-labels?ids[]=<plan_id>.
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS gazelka_plan_id BIGINT NULL;
