-- Переносим товар с полки A-01 (id=1) на «Нижняя полка» (id=13),
-- чтобы полку A-01 можно было удалить в интерфейсе
UPDATE goods_warehouse SET shelf_id = 13 WHERE shelf_id = 1;