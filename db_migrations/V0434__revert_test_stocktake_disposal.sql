-- ОТКАТ ошибочного списания по инвентаризации №1.
--
-- Инвентаризация №1 была технической проверкой механизма, но подтверждение
-- выполнилось на боевых данных и списало 167 реальных вещей: они физически
-- лежат на складе, просто их никто не сканировал. Возвращаем их в оборот.
--
-- Полку восстанавливаем там, где её удалось найти в журнале действий. Остальным
-- адрес проставит первая же настоящая инвентаризация: скан на полке сам поправит
-- место хранения.

UPDATE goods_warehouse gw
SET status = 'in_stock',
    lost_reason = NULL,
    lost_at = NULL,
    dispose_reason = NULL,
    disposed_at = NULL,
    disposed_by = NULL,
    shelf_id = COALESCE(
      (SELECT s.id FROM shelves s
        WHERE s.name = (
          SELECT substring(a.description from 'Положил на полку ([^:]+):')
          FROM audit_log a
          WHERE a.entity_type = 'goods_warehouse' AND a.entity_id = gw.id
            AND a.description LIKE 'Положил на полку %'
          ORDER BY a.created_at DESC LIMIT 1
        )
        LIMIT 1),
      gw.shelf_id
    )
WHERE gw.lost_reason = 'Не найдена при инвентаризации №1';

-- Саму техническую инвентаризацию помечаем отменённой, чтобы она не путалась
-- в истории с настоящими пересчётами.
UPDATE stocktakes
SET status = 'rejected',
    reject_reason = 'Техническая проверка механизма, списание отменено'
WHERE id = 1;
