-- Новая должность «Старший кладовщик».
-- Права у неё те же, что у обычного кладовщика, отличаются только ставки,
-- поэтому заводим отдельные строки тарифов для каждого цеха.
-- Стартовое значение копируем с обычного кладовщика — руководство поменяет
-- его в разделе «Тарифы» вручную.
INSERT INTO salary_rates (role, workshop_id, rate, material_id, width)
SELECT 'senior_storekeeper', w.id,
       COALESCE((SELECT sr.rate FROM salary_rates sr
                 WHERE sr.role = 'storekeeper' AND sr.workshop_id = w.id
                 LIMIT 1), 0),
       NULL, NULL
FROM workshops w
WHERE NOT EXISTS (
  SELECT 1 FROM salary_rates sr2
  WHERE sr2.role = 'senior_storekeeper' AND sr2.workshop_id = w.id
);