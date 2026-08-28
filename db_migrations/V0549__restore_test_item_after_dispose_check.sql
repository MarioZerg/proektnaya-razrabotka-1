-- Возвращаем тестовую вещь GW-721921 в исходное состояние.
--
-- На ней проверяли новый путь «на утилизацию → нашлась → обратно на склад».
-- Проверка прошла, но вещь физически так и не разобрана: она должна остаться
-- во вкладке «Разобрать возвраты», как и была до проверки.
UPDATE goods_warehouse
   SET status = 'mp_return',
       shelf_id = NULL,
       dispose_reason = NULL,
       lost_reason = NULL
 WHERE id = 154;

UPDATE marketplace_returns
   SET status = 'picked_up',
       outcome = NULL,
       outcome_at = NULL,
       outcome_by = NULL,
       damage_note = NULL
 WHERE goods_warehouse_id = 154;