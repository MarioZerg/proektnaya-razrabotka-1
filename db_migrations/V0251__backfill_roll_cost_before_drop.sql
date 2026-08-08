-- Перенос справочной цены материала на рулоны перед удалением поля materials.cost.
--
-- Себестоимость теперь живёт на рулоне (cost_per_unit) — она точная: цена поставщика
-- по курсу плюс логистика. Но у рулонов, принятых до этой системы, цены нет, и расчёты
-- недостач подставляли справочную цену материала. Убрать поле, не перенеся цены, значит
-- обнулить деньги по этим рулонам.
UPDATE t_p86119184_proektnaya_razrabotk.rolls r
SET cost_per_unit = m.cost,
    purchase_price = m.cost,
    purchase_currency = COALESCE(r.purchase_currency, 'RUB'),
    purchase_rate = COALESCE(r.purchase_rate, 1)
FROM t_p86119184_proektnaya_razrabotk.materials m
WHERE m.id = r.material_id
  AND r.cost_per_unit IS NULL
  AND m.cost > 0;
