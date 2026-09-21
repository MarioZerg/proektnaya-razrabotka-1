-- Повторно возвращаем вещь GW-723267 в поставку FBO.
--
-- Первое исправление (V0657) сделано ДО того, как обновлённый код планировщика WB
-- уехал на сервер. В 13:49 планировщик отработал ещё раз по старой логике и снова
-- пометил вещь отгруженной —那 же отмена старого WB-заказа 5473775779.
--
-- Теперь исправленный код задеплоен: при наличии резерва вещь принадлежит только
-- заказу из резерва, и чужая отмена её больше не трогает. Возвращаем запись в
-- правильное состояние окончательно.
UPDATE goods_warehouse
SET status = 'awaiting_supply',
    shipped_at = NULL
WHERE id = 1607
  AND status = 'shipped'
  AND EXISTS (
      SELECT 1
      FROM marketplace_supply_items msi
      JOIN marketplace_supplies s ON s.id = msi.supply_id
      WHERE msi.goods_warehouse_id = goods_warehouse.id
        AND s.status NOT IN ('Выполнена', 'Отменена')
  );
