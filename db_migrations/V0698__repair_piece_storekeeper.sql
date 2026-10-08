-- Кто завёл кусок на перешив: упаковщица с перепаковки или кладовщик с брака.
--
-- Кладовщик забирает вещь из утилизации (стикер «БРАК» с номером GW-…) и
-- кладёт её в куски. Номер тот же, чтобы цепочка заказа не обрывалась.
-- Без этой пометки в таблице не отличить, откуда отрез.

ALTER TABLE repair_fabric_pieces
    ADD COLUMN IF NOT EXISTS added_by_role VARCHAR(40);

UPDATE repair_fabric_pieces
SET added_by_role = 'packer'
WHERE added_by_role IS NULL;

COMMENT ON COLUMN repair_fabric_pieces.added_by_role IS
    'Кто завёл кусок: packer — упаковщица с перепаковки, storekeeper — кладовщик с брака/утиля, admin — администратор.';
