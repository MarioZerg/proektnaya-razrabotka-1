-- Закрываем лишние цеха: производство остаётся только в «Цех №1».
--
-- «Цех №2» был настоящим производством — людей сажаем в смену №3 первого цеха,
-- заказы и рулоны тоже переносим. «Тестовый цех (QA)» — полигон: его заказы
-- и рулоны в боевой цех не смешиваем, только выключаем цех и переводим
-- сотрудников. Строки цехов оставляем (на них ссылается история). Смены
-- закрытых цехов удаляем — иначе в списке висит «Смена 1 / Цех №2».
-- Сливать строки смен первого и второго цеха нельзя
-- (UNIQUE workshop_id + shift_number).

DO $$
DECLARE
  keep_id INTEGER;
  closed_id INTEGER;
  closed_name TEXT;
BEGIN
  SELECT id INTO keep_id FROM workshops WHERE name = 'Цех №1';
  IF keep_id IS NULL THEN
    RETURN;
  END IF;

  FOREACH closed_name IN ARRAY ARRAY['Цех №2', 'Тестовый цех (QA)']
  LOOP
    SELECT id INTO closed_id FROM workshops WHERE name = closed_name;
    IF closed_id IS NULL OR closed_id = keep_id THEN
      CONTINUE;
    END IF;

    -- Смена №3 в первом цехе уже есть; на всякий случай создаём, если вдруг нет.
    INSERT INTO shifts (workshop_id, shift_number, name, is_active)
    SELECT keep_id, 3, 'Смена №3', true
    WHERE NOT EXISTS (
      SELECT 1 FROM shifts WHERE workshop_id = keep_id AND shift_number = 3
    );

    IF closed_name = 'Цех №2' THEN
      -- Людей второго цеха сажаем в смену №3 первого, а не оставляем
      -- «Цех №1 / смена 1» — это другая бригада.
      UPDATE users
      SET workshop = 'Цех №1', shift_number = 3
      WHERE workshop = closed_name;
    ELSE
      UPDATE users SET workshop = 'Цех №1' WHERE workshop = closed_name;
    END IF;

    -- Кто сейчас открыл смену в закрытом цехе — переводим в первый,
    -- иначе человек останется в цехе, которого больше нет на экране.
    UPDATE shift_sessions
    SET workshop_id = keep_id
    WHERE workshop_id = closed_id AND closed_at IS NULL;

    IF closed_name = 'Цех №2' THEN
      UPDATE orders SET workshop_id = keep_id WHERE workshop_id = closed_id;
      UPDATE rolls SET workshop_id = keep_id WHERE workshop_id = closed_id;
      UPDATE shipments SET workshop_id = keep_id WHERE workshop_id = closed_id;
      UPDATE shift_sessions SET workshop_id = keep_id WHERE workshop_id = closed_id;
      UPDATE goods_warehouse SET repack_workshop_id = keep_id WHERE repack_workshop_id = closed_id;
      UPDATE material_defects SET workshop_id = keep_id WHERE workshop_id = closed_id;
      UPDATE cost_settings SET workshop_id = keep_id WHERE workshop_id = closed_id;
      UPDATE repair_fabric_pieces SET workshop_id = keep_id WHERE workshop_id = closed_id;
      UPDATE order_material_usage SET actor_workshop_id = keep_id WHERE actor_workshop_id = closed_id;

      DELETE FROM vacations v
      WHERE v.workshop_id = closed_id
        AND EXISTS (
          SELECT 1 FROM vacations k
          WHERE k.workshop_id = keep_id
            AND k.shift_number IS NOT DISTINCT FROM v.shift_number
            AND k.starts_on = v.starts_on
            AND k.ends_on = v.ends_on
        );
      UPDATE vacations SET workshop_id = keep_id WHERE workshop_id = closed_id;

      DELETE FROM marketplace_item_materials closed
      WHERE closed.workshop_id = closed_id
        AND EXISTS (
          SELECT 1 FROM marketplace_item_materials keep
          WHERE keep.workshop_id = keep_id
            AND keep.marketplace_item_id = closed.marketplace_item_id
            AND keep.material_id IS NOT DISTINCT FROM closed.material_id
        );
      UPDATE marketplace_item_materials SET workshop_id = keep_id WHERE workshop_id = closed_id;

      DELETE FROM auto_order_blocks closed
      WHERE closed.workshop_id = closed_id
        AND EXISTS (
          SELECT 1 FROM auto_order_blocks keep
          WHERE keep.workshop_id = keep_id
            AND keep.material_id = closed.material_id
            AND keep.shift_number IS NOT DISTINCT FROM closed.shift_number
        );
      UPDATE auto_order_blocks SET workshop_id = keep_id WHERE workshop_id = closed_id;
    ELSE
      -- Тестовые рулоны и заказы оставляем на старом id, но из живых очередей
      -- убираем: иначе после выключения цеха они всплывут, если кто-то откроет
      -- список без фильтра.
      UPDATE rolls
      SET remaining_quantity = 0,
          packer_returned_quantity = 0,
          status = 'completed',
          completed_at = COALESCE(completed_at, now())
      WHERE workshop_id = closed_id
        AND status <> 'completed';

      UPDATE orders
      SET status = 'Отменён',
          sewing_status = 'Готовые'
      WHERE workshop_id = closed_id
        AND status <> 'Отменён';
    END IF;

    DELETE FROM salary_rates WHERE workshop_id = closed_id;
    DELETE FROM workshop_settings WHERE workshop_id = closed_id;
    DELETE FROM shift_calendar WHERE workshop_id = closed_id;
    DELETE FROM auto_order_blocks WHERE workshop_id = closed_id;

    -- Саму строку смены второго цеха убираем: иначе в списке смен остаётся
    -- «Смена 1 / Цех №2». Сливать её со сменами первого цеха нельзя
    -- (UNIQUE workshop_id + shift_number).
    DELETE FROM shifts WHERE workshop_id = closed_id;
    UPDATE workshops
    SET is_active = false, shifts_count = 0, shift_names = '[]'::jsonb
    WHERE id = closed_id;
  END LOOP;
END $$;
