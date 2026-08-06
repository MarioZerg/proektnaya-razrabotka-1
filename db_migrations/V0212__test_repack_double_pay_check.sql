-- ТЕСТ: возвращаем вещь на перепаковку, чтобы проверить защиту от повторной оплаты
-- одного и того же возврата (упаковщица не должна получить 20 руб дважды).
UPDATE goods_warehouse SET status = 'repacking', repack_new_bag = NULL
WHERE storage_barcode = 'GW-RPK001';