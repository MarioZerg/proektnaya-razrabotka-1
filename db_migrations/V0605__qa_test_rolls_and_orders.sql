-- ТЕСТОВЫЕ РУЛОНЫ И ЗАКАЗЫ В ТЕСТОВОМ ЦЕХЕ (id 7).
--
-- Нужны, чтобы прогнать движение материала и заказов вживую: раскрой, списание,
-- возврат остатка на рулон, закрытие рулона. Всё лежит в тестовом цехе и не
-- пересекается с боевыми остатками.
--
-- Штрихкоды с префиксом QA-TEST- : по нему тестовые данные легко найти и удалить.
--
-- Рулон ткани намеренно маленький (10 м): так быстро упереться в границы —
-- нехватку материала, закрытие с остатком, отрицательный остаток.

INSERT INTO rolls (barcode, material_id, workshop_id, shift_number,
                   initial_quantity, remaining_quantity, status, accepted_at,
                   cost_per_unit, shortage_norm_percent)
VALUES
  ('QA-TEST-LEN-1',    2,  7, 1, 10.000, 10.000, 'in_workshop', now(), 100.0000, 2.000),
  ('QA-TEST-TESMA-1',  6,  7, 1, 50.000, 50.000, 'in_workshop', now(),  10.0000, 2.000),
  ('QA-TEST-PAKET-1', 10,  7, 1, 100.000, 100.000, 'in_workshop', now(), 5.0000, 2.000),
  ('QA-TEST-ETIK-1',  14,  7, 1, 100.000, 100.000, 'in_workshop', now(), 1.0000, 2.000)
ON CONFLICT (barcode) DO NOTHING;

-- Тестовые заказы: тот же товар «Лен 300x230», что и в боевой номенклатуре, но
-- с номерами QA-TEST-*. Стартуют «Новый» — дальше прогоняем их по конвейеру.
INSERT INTO orders (order_number, marketplace, order_type, status, sewing_status,
                    product, material, width, height, quantity, source,
                    workshop_id, marketplace_item_id)
VALUES
  ('QA-TEST-ORD-1', 'OZON', 'FBO', 'Новый', 'Новый', 'Лен 300x230', 'Лен', 300, 230, 1, 'manual', 7, 243),
  ('QA-TEST-ORD-2', 'OZON', 'FBO', 'Новый', 'Новый', 'Лен 300x230', 'Лен', 300, 230, 1, 'manual', 7, 243),
  ('QA-TEST-ORD-3', 'OZON', 'FBO', 'Новый', 'Новый', 'Лен 300x230', 'Лен', 300, 230, 1, 'manual', 7, 243),
  ('QA-TEST-ORD-4', 'OZON', 'FBO', 'Новый', 'Новый', 'Лен 300x230', 'Лен', 300, 230, 1, 'manual', 7, 243)
ON CONFLICT (order_number) DO NOTHING;
