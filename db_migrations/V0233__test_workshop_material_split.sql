-- ТЕСТ разделения цехов: заказ на «Вуаль без утяжелителя» — материал ТОЛЬКО Цеха №2.
-- Проверим, что закройщик Цеха №1 его не возьмёт, а закройщик Цеха №2 возьмёт.
INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, source,
                    material, width, height, sewing_status)
VALUES ('W2-TEST-01','OZON','FBO','Новый','Вуаль без утяжелителя 300x270',1,'manual',
        'Вуаль без утяжелителя',300,270,'Новый');