-- Таймауты взятия заказов теперь считаются в МИНУТАХ. Выравниваем значения по логике:
-- чем шире изделие, тем дольше оно шьётся, значит и задержка перед следующим заказом больше.
-- В Цехе №1 было 5,5,5,4,5,5,5 — у 500 см задержка была меньше, чем у 200 см.
UPDATE workshop_settings SET value = '4' WHERE workshop_id = 1 AND key = 'timeout_200';
UPDATE workshop_settings SET value = '5' WHERE workshop_id = 1 AND key = 'timeout_300';
UPDATE workshop_settings SET value = '6' WHERE workshop_id = 1 AND key = 'timeout_400';
UPDATE workshop_settings SET value = '7' WHERE workshop_id = 1 AND key = 'timeout_500';
UPDATE workshop_settings SET value = '8' WHERE workshop_id = 1 AND key = 'timeout_600';
UPDATE workshop_settings SET value = '9' WHERE workshop_id = 1 AND key = 'timeout_700';
UPDATE workshop_settings SET value = '10' WHERE workshop_id = 1 AND key = 'timeout_800';

UPDATE workshop_settings SET value = '4' WHERE workshop_id = 2 AND key = 'timeout_200';
UPDATE workshop_settings SET value = '5' WHERE workshop_id = 2 AND key = 'timeout_300';
UPDATE workshop_settings SET value = '6' WHERE workshop_id = 2 AND key = 'timeout_400';
UPDATE workshop_settings SET value = '7' WHERE workshop_id = 2 AND key = 'timeout_500';
UPDATE workshop_settings SET value = '8' WHERE workshop_id = 2 AND key = 'timeout_600';
UPDATE workshop_settings SET value = '9' WHERE workshop_id = 2 AND key = 'timeout_700';
UPDATE workshop_settings SET value = '10' WHERE workshop_id = 2 AND key = 'timeout_800';

-- Глобальные значения по умолчанию — тоже в минутах, по возрастанию ширины.
UPDATE system_settings SET value = '4' WHERE key = 'timeout_200';
UPDATE system_settings SET value = '5' WHERE key = 'timeout_300';
UPDATE system_settings SET value = '6' WHERE key = 'timeout_400';
UPDATE system_settings SET value = '7' WHERE key = 'timeout_500';
UPDATE system_settings SET value = '8' WHERE key = 'timeout_600';
UPDATE system_settings SET value = '9' WHERE key = 'timeout_700';
UPDATE system_settings SET value = '10' WHERE key = 'timeout_800';
