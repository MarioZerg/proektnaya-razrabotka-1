-- Себестоимость единицы для перенесённых рулонов.
--
-- При переносе из старой системы цена легла в purchase_price (цена закупки),
-- а склад и отчёты считают стоимость по cost_per_unit — из-за этого весь склад
-- показывал нулевую стоимость. Логистики в старых данных нет, поэтому
-- себестоимость равна цене закупки.
UPDATE rolls
SET cost_per_unit = purchase_price
WHERE cost_per_unit IS NULL
  AND purchase_price IS NOT NULL
  AND purchase_price > 0;

-- Там, где цены прихода в старой базе не было, берём справочную цену материала:
-- рулон без себестоимости выпадает из расчёта стоимости склада целиком.
UPDATE rolls r
SET cost_per_unit = m.cost
FROM materials m
WHERE m.id = r.material_id
  AND r.cost_per_unit IS NULL
  AND m.cost > 0;
