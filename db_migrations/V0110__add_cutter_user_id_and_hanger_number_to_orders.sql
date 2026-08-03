-- Закройщик, раскроивший заказ — сохраняется отдельно, так как assigned_user_id
-- перезаписывается на швею при take_order, и без этого поля история "кто кроил" терялась бы.
ALTER TABLE orders ADD COLUMN cutter_user_id INTEGER NULL REFERENCES users(id);

-- Номер вешалки, на которую подвешен раскроенный товар — по умолчанию 0 (не назначена),
-- будет заполняться через отдельную вкладку "Вешалки" в будущем.
ALTER TABLE orders ADD COLUMN hanger_number INTEGER NOT NULL DEFAULT 0;

-- Заполняем cutter_user_id для уже раскроенных заказов текущим assigned_user_id (лучшее
-- приближение для существующих данных — для заказов, которые уже в работе/готовы, это
-- зачастую уже швея, а не закройщик, но это единственные исторические данные, что есть).
UPDATE orders SET cutter_user_id = assigned_user_id
WHERE cut_at IS NOT NULL AND cutter_user_id IS NULL;