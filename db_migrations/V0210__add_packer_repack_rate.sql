-- Тариф упаковщицы за перепаковку возвратов: 20 руб за штуку, без привязки к размеру.
-- Отдельная роль 'packer_repack', потому что у 'packer' уже есть своя ставка за пог.м.
-- на стикеровке, а перепаковка оплачивается иначе — просто штучно.
-- Заводим для ВСЕХ цехов, чтобы тариф был везде одинаково доступен.
INSERT INTO salary_rates (role, material_id, width, rate, workshop_id)
SELECT 'packer_repack', NULL, NULL, 20, w.id FROM workshops w
ON CONFLICT (workshop_id, role, COALESCE(material_id, 0), COALESCE(width, 0)) DO NOTHING;

-- Отмечаем, использовала ли упаковщица новый пакет при перепаковке: спрашиваем на киоске,
-- чтобы видеть реальный расход упаковки по возвратам.
ALTER TABLE goods_warehouse ADD COLUMN IF NOT EXISTS repack_new_bag BOOLEAN;