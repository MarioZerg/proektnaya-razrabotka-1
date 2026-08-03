-- Тарифы закройщика (role='cutter') раньше зависели только от материала (одна ставка на
-- любой размер товара) — это давало некорректный расчёт зарплаты, так как раскрой заказа
-- считался от технологического расхода ткани с запасом на подгибку (marketplace_item_materials.quantity),
-- а не от чистой ширины товара. Теперь тариф закройщика зависит от материала И ширины,
-- аналогично тарифу швеи, а начисление считается от чистой ширины (width/100 пог.м.).

-- Существующую ставку (width IS NULL) превращаем в ставку для ширины 200 (сохраняя текущее
-- значение как стартовое для этой ширины).
UPDATE salary_rates SET width = 200
WHERE role = 'cutter' AND width IS NULL;

-- Для остальных ширин (300..800), реально встречающихся у товаров с материалом типа "Тюль",
-- создаём новые строки тарифа с тем же стартовым значением ставки, что и у ширины 200.
INSERT INTO salary_rates (role, material_id, width, rate, workshop_id)
SELECT 'cutter', sr.material_id, widths.width, sr.rate, sr.workshop_id
FROM salary_rates sr
CROSS JOIN (
    SELECT DISTINCT mim.material_id, mi.width
    FROM marketplace_items mi
    JOIN marketplace_item_materials mim ON mim.marketplace_item_id = mi.id
    JOIN materials m ON m.id = mim.material_id
    JOIN material_types mt ON mt.id = m.type_id
    WHERE mt.name = 'Тюль' AND mi.width IS NOT NULL AND mi.width != 200
) widths
WHERE sr.role = 'cutter' AND sr.width = 200 AND sr.material_id = widths.material_id
ON CONFLICT DO NOTHING;