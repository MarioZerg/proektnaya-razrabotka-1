-- Откат проверочной записи на рулоне 1-005292.
--
-- При приёмке правки я вернул на рулон тестовые 2.5 м, чтобы убедиться, что этот
-- метраж не попадает в расчёт штрафа за недостачу. Проверка удалась.
--
-- Возвращаю остаток к прежнему значению, чтобы цифра в системе совпадала с тем,
-- что физически лежит в цехе. Записи в истории не удаляю (данные не стираем) —
-- помечаю их как проверочные, чтобы никто не принял их за реальную работу.
UPDATE rolls
   SET remaining_quantity = remaining_quantity - 2.5,
       packer_returned_quantity = 0
 WHERE id = 5560
   AND packer_returned_quantity = 2.5;

UPDATE roll_packer_returns
   SET quantity = 0,
       note = 'ОТМЕНЕНО: проверочная запись при настройке возврата на рулон'
 WHERE roll_id = 5560
   AND user_name = 'Проверка';

UPDATE audit_log
   SET description = 'ОТМЕНЕНО (проверочная запись при настройке): ' || description
 WHERE action = 'roll_packer_return'
   AND entity_id = 5560
   AND user_name = 'Проверка';