INSERT INTO marketplace_item_materials (marketplace_item_id, material_id, quantity)
SELECT mi.id, m.id, v.quantity
FROM marketplace_items mi
CROSS JOIN (VALUES
    ('Вуаль', 2.05),
    ('Тесьма 6 см', 2.10),
    ('Пакет 25х30', 1.00),
    ('Этикетка на пакет 58х40', 1.00)
) AS v(material_name, quantity)
JOIN materials m ON m.name = v.material_name
WHERE mi.sku LIKE 'vyal2%';