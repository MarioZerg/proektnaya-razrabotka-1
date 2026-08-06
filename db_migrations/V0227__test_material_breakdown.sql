-- ТЕСТ разбивки по материалам в виджете «Новые заказы»: несколько заказов разных
-- тканей и размеров, чтобы проверить суммирование метража и сортировку.
INSERT INTO orders (order_number, marketplace, order_type, status, product, quantity, source,
                    material, width, height, sewing_status)
VALUES
 ('MAT-TEST-01','OZON','FBO','Новый','Вуаль 300x260',1,'manual','Вуаль',300,260,'Новый'),
 ('MAT-TEST-02','OZON','FBO','Новый','Вуаль 300x260',1,'manual','Вуаль',300,260,'Новый'),
 ('MAT-TEST-03','WB','FBO','Новый','Вуаль 300x260',1,'manual','Вуаль',300,260,'Новый'),
 ('MAT-TEST-04','WB','FBS','Новый','Бамбук 200x240',1,'manual','Бамбук',200,240,'Новый'),
 ('MAT-TEST-05','OZON','FBS','Новый','Сетка 400x270',1,'manual','Сетка',400,270,'Новый');