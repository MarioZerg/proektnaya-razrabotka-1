-- Проставляем себестоимость уже принятым рулонам: берём текущую цену из справочника
-- материалов (вуаль 80 ₽, шифон 130 ₽ и т.д.). Логистики у них нет — она появится
-- только у новых поставок. Так отчёты по недостачам в деньгах заработают сразу.
UPDATE rolls r
SET cost_per_unit = m.cost,
    purchase_price = m.cost,
    purchase_currency = 'RUB',
    purchase_rate = 1
FROM materials m
WHERE m.id = r.material_id
  AND r.cost_per_unit IS NULL
  AND m.cost > 0;