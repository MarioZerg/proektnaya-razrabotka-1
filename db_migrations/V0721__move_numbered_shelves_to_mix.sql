-- Полка «Микс»: сюда переносим всё с номерных полок (1–12) и «Сбор ФБО».
INSERT INTO shelves (name)
SELECT 'Микс' WHERE NOT EXISTS (SELECT 1 FROM shelves WHERE name = 'Микс');

-- Все записи склада (и лежащие сейчас, и историю), чтобы старые полки опустели
-- и их можно было убрать. «Перепаковка», «Ходовая» и «Не ходовая» не трогаем.
UPDATE goods_warehouse
SET shelf_id = (SELECT id FROM shelves WHERE name = 'Микс' ORDER BY id LIMIT 1)
WHERE shelf_id IN (
    SELECT id FROM shelves WHERE name ~ '^\s*\d+\s*$' OR name = 'Сбор ФБО'
);