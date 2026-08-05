-- Возвращаем комментарии поставок, изменённые при проверке прав менеджера.
UPDATE marketplace_supplies SET comment = NULL WHERE id = 18 AND comment = 'менеджер ведёт FBO';
UPDATE marketplace_supplies SET comment = 'ТЕСТ связок (проверка завершена)'
WHERE id = 22 AND comment = 'админ';
