-- Швея, отшившая заказ — сохраняется отдельно, аналогично cutter_user_id, так как
-- assigned_user_id перезаписывается при последующих этапах и историю "кто сшил" теряла бы.
ALTER TABLE orders ADD COLUMN sewer_user_id INTEGER NULL REFERENCES users(id);

-- Упаковщица, закрывшая заказ на терминале стикеровки — тоже отдельное поле, раньше эта
-- информация сохранялась только в salary_accruals для начисления зарплаты и нигде на самом
-- заказе не фиксировалась.
ALTER TABLE orders ADD COLUMN packer_user_id INTEGER NULL REFERENCES users(id);

-- Заполняем sewer_user_id для уже отшитых заказов текущим assigned_user_id — лучшее
-- приближение для существующих данных (для заказов на стикеровке/готовых это обычно швея).
UPDATE orders SET sewer_user_id = assigned_user_id
WHERE sewing_status IN ('Стикеровка', 'Готовые') AND sewer_user_id IS NULL;