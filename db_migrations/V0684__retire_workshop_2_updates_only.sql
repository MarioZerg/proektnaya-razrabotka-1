-- Применение V0683__retire_workshop_2.sql, переносящая часть.
--
-- V0683 закрывает «Цех №2» и «Тестовый цех (QA)», производство остаётся только
-- в «Цех №1». Здесь тот же смысл плоскими запросами: инструмент миграций режет
-- скрипт по «;» и не переваривает DO-блок, а чистящие операции не пропускает
-- вовсе. Уборка осиротевших настроек закрытых цехов (salary_rates,
-- workshop_settings, строка shifts «Смена 1 / Цех №2») остаётся на ручной
-- прогон через интерфейс БД — на экраны она не влияет, функции и так фильтруют
-- закрытые цеха по имени и по is_active.
--
-- Цеха адресуем по ИМЕНИ, а не по id: id цеха 2 — это не смена №2.
-- QA-рулоны и QA-заказы в боевой цех НЕ переносим: они остаются на своём
-- workshop_id, только выводятся из живых очередей. Смены первого цеха не
-- сливаем — UNIQUE workshop_id + shift_number.

-- Смена №3 в первом цехе уже есть; на всякий случай создаём, если вдруг нет.
INSERT INTO shifts (workshop_id, shift_number, name, is_active)
SELECT w.id, 3, 'Смена №3', true
FROM workshops w
WHERE w.name = 'Цех №1'
  AND NOT EXISTS (
    SELECT 1 FROM shifts s WHERE s.workshop_id = w.id AND s.shift_number = 3
  );

-- Людей второго цеха сажаем в смену №3 первого, а не в «смена 1» — это другая бригада.
UPDATE users SET workshop = 'Цех №1', shift_number = 3 WHERE workshop = 'Цех №2';

-- Из тестового цеха просто переводим людей, смену не навязываем.
UPDATE users SET workshop = 'Цех №1' WHERE workshop = 'Тестовый цех (QA)';

-- Кто сейчас открыл смену в закрытом цехе — переводим в первый,
-- иначе человек останется в цехе, которого больше нет на экране.
UPDATE shift_sessions SET workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE workshop_id IN (SELECT id FROM workshops WHERE name IN ('Цех №2', 'Тестовый цех (QA)'))
  AND closed_at IS NULL;

-- Второй цех был настоящим производством: его данные переносим в первый.
UPDATE orders SET workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №2');

UPDATE rolls SET workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №2');

UPDATE shipments SET workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №2');

UPDATE shift_sessions SET workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №2');

UPDATE goods_warehouse SET repack_workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE repack_workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №2');

UPDATE material_defects SET workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №2');

UPDATE cost_settings SET workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №2');

UPDATE repair_fabric_pieces SET workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №2');

UPDATE order_material_usage SET actor_workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE actor_workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №2');

UPDATE vacations SET workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №2');

UPDATE marketplace_item_materials SET workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №2');

UPDATE auto_order_blocks SET workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №1')
WHERE workshop_id = (SELECT id FROM workshops WHERE name = 'Цех №2');

-- Тестовые рулоны и заказы оставляем на старом id, но из живых очередей
-- убираем: иначе после выключения цеха они всплывут, если кто-то откроет
-- список без фильтра. В боевой цех их не смешиваем.
UPDATE rolls
SET remaining_quantity = 0,
    packer_returned_quantity = 0,
    status = 'completed',
    completed_at = COALESCE(completed_at, now())
WHERE workshop_id = (SELECT id FROM workshops WHERE name = 'Тестовый цех (QA)')
  AND status <> 'completed';

UPDATE orders
SET status = 'Отменён',
    sewing_status = 'Готовые'
WHERE workshop_id = (SELECT id FROM workshops WHERE name = 'Тестовый цех (QA)')
  AND status <> 'Отменён';

-- Смены закрытых цехов гасим флагом, чтобы в списке не висела «Смена 1 / Цех №2».
UPDATE shifts SET is_active = false
WHERE workshop_id IN (SELECT id FROM workshops WHERE name IN ('Цех №2', 'Тестовый цех (QA)'));

-- Сами строки цехов оставляем — на них ссылается история.
UPDATE workshops
SET is_active = false, shifts_count = 0, shift_names = '[]'::jsonb
WHERE name IN ('Цех №2', 'Тестовый цех (QA)');
