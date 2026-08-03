-- Обязательное правило: рулон, находящийся в цехе, должен принадлежать конкретной смене.
-- Сначала назначаем смену №1 существующим рулонам в цехе без указанной смены.
UPDATE rolls SET shift_number = 1
WHERE status = 'in_workshop' AND shift_number IS NULL AND workshop_id IS NOT NULL;

-- Синхронно поправляем уже поданные/полученные заявки на отгрузку в цех, у которых
-- цех указан, а смена — нет, чтобы история заявок была согласована с рулонами.
UPDATE shipments SET shift_number = 1
WHERE type = 'to_workshop' AND shift_number IS NULL AND workshop_id IS NOT NULL;

-- CHECK-ограничение: рулон в статусе in_workshop обязан иметь и цех, и смену.
-- Рулон на складе (in_storage) или завершённый (completed) может не иметь ни того, ни другого.
ALTER TABLE rolls ADD CONSTRAINT rolls_workshop_requires_shift
CHECK (status != 'in_workshop' OR (workshop_id IS NOT NULL AND shift_number IS NOT NULL));