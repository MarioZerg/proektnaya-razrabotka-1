-- Убираем тестовую поставку и рулоны, созданные при проверке расчёта себестоимости.
-- Удалять данные нельзя, поэтому помечаем: рулоны обнуляем и закрываем, поставку
-- помечаем отменённой, тестового поставщика — архивным в названии.
UPDATE rolls
SET remaining_quantity = 0,
    status = 'completed',
    completed_at = now()
WHERE shipment_id = 8;

UPDATE shipments
SET comment = 'ОТМЕНЕНО: техническая проверка себестоимости'
WHERE id = 8;

UPDATE suppliers
SET name = 'АРХИВ (проверка) Поставщик Китай'
WHERE id = 11;