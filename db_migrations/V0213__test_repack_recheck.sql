-- Ещё раз возвращаем вещь на перепаковку — проверяем, что повторная оплата теперь
-- показывается как 0, а не как 20 руб.
UPDATE goods_warehouse SET status = 'repacking' WHERE storage_barcode = 'GW-RPK001';