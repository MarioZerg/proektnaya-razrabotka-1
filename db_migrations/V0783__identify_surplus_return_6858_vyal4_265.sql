UPDATE t_p86119184_proektnaya_razrabotk.orders
SET product = 'Вуаль 400x265', material = 'Вуаль', width = 400, height = 265,
    marketplace_item_id = 378, product_ozon_sku = '1207101317', product_barcode = 'OZN1207101316'
WHERE id = 123558 AND marketplace_item_id IS NULL;

UPDATE t_p86119184_proektnaya_razrabotk.marketplace_returns
SET marketplace_item_id = 378, sku = '1207101317', offer_id = 'vyal4_265',
    product_name = 'Вуаль 400x265 (неопознанный излишек, на вещи ярлык OZN1207101317)'
WHERE id = 6858 AND marketplace_item_id IS NULL;