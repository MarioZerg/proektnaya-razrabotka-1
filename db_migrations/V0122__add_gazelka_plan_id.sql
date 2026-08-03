-- Связь поставки маркетплейса с заявкой на грузоперевозку в сервисе Газелька (gazelka.space).
-- gazelka_plan_id — id заявки (plan) в Газельке, выбирается менеджером вручную из списка my-plans.
-- По нему строится ссылка на печать стикеров коробов: gazelka.space/print-labels?ids[]=<plan_id>.
ALTER TABLE marketplace_supplies ADD COLUMN IF NOT EXISTS gazelka_plan_id BIGINT NULL;
