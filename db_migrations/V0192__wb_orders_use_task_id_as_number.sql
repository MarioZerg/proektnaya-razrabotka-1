-- Заказы WB FBS показываем сотрудникам под номером сборочного задания (5425685523),
-- как в личном кабинете WB и на стикере. Раньше в номер попадал технический код rid
-- вида "eAD.iba337cd...1.0" — длинный и непонятный для цеха.
UPDATE orders
SET order_number = wb_order_id::text
WHERE marketplace = 'WB'
  AND order_type = 'FBS'
  AND wb_order_id IS NOT NULL
  AND order_number !~ '^[0-9]+$';