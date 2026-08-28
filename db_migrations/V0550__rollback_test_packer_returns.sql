-- Откатываем тестовые возвраты материала на рулон.
--
-- На них проверяли новый порядок: метраж считается сам по ширине вещи, а рулон
-- принимается только свой (тот же материал, цех и смена). Проверка прошла, но
-- метры физически на рулон никто не клал — снимаем их обратно, иначе остаток
-- в системе разойдётся с рулоном на полке.
--
-- Сами записи истории не удаляем (история склада должна оставаться целой),
-- а обнуляем и помечаем как проверочные.
UPDATE rolls r
   SET remaining_quantity = r.remaining_quantity - t.qty,
       packer_returned_quantity = GREATEST(COALESCE(r.packer_returned_quantity, 0) - t.qty, 0)
  FROM (
        SELECT roll_id, SUM(quantity) AS qty
          FROM roll_packer_returns
         WHERE user_name = 'Проверка' AND quantity > 0
         GROUP BY roll_id
       ) t
 WHERE r.id = t.roll_id;

UPDATE roll_packer_returns
   SET quantity = 0,
       note = 'Техническая проверка, метраж откачен'
 WHERE user_name = 'Проверка';