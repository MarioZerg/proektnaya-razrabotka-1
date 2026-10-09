-- 146 отправлений OZON с листа сборки 08.10.2026 закрываем в «Готовые» без начислений
-- и списываем ткань с рулонов смены, которая сегодня работает.
--
-- ЧТО СЛУЧИЛОСЬ. Датацентр Поехали закрылся, сервис переехал. Вещи уже собраны
-- и поедут вручную. Если оставить их на конвейере, цех сошьёт их второй раз,
-- а в карточках не будет расхода ткани — остатки рулонов потом не сойдутся.
--
-- ТКАНЬ. Только тип «Тюль», норма из состава товара (marketplace_item_materials),
-- иначе ширина / 100. Тесьму и пакеты не трогаем: их списывает конвейер.
--
-- ДВЕ СМЕНЫ. Часть листа (~40) уже была в «Раскроено»: их кроила другая смена
-- и перевела в этот список. У таких заказов расход либо уже есть — не трогаем,
-- либо списываем с РУЛОНОВ ТОЙ смены (закройщик / смена на момент cut_at).
-- Остальные, которых ещё не кроили, — с рулонов смены, которая работает сегодня.
-- Иначе сегодняшняя смена «съест» чужие метры, а у вчерашней остаток не сойдётся.
--
-- Рулоны — принятые в цехе, без брака, той же пары workshop + shift_number.
-- Сегодняшняя смена: сначала открытая сейчас, иначе открывавшаяся сегодня по Москве.
-- Если ткани на нужной смене не хватит — вся миграция откатывается.
--
-- КАРТОЧКА. material / width / height / marketplace_item_id с артикула листа.
-- workshop_id — цех сегодняшней смены, если у заказа пусто.
--
-- ЧЕГО НЕТ. Начислений нет. packer_user_id не ставим. Складскую строку не заводим.
-- Ищем по номеру отправления, не по хвосту этикетки ii.

CREATE TEMP TABLE _ozon146 (
    posting VARCHAR(50) PRIMARY KEY,
    sku VARCHAR(100) NOT NULL
);

INSERT INTO _ozon146 (posting, sku) VALUES
    ('62791355-0142-3', 'grek4_270'),
    ('34701169-0082-1', 'grek3_270'),
    ('0145923587-0033-1', 'grek3_275'),
    ('62791355-0143-1', 'grek4_265'),
    ('0256659550-0048-1', 'grek3_275'),
    ('0155289966-0119-6', 'grek3_270'),
    ('0155289966-0119-15', 'grek3_270'),
    ('0101677202-0098-3', 'grek6_280'),
    ('83549626-0942-1', 'grek4_260'),
    ('96382069-0268-1', 'grek2_280'),
    ('96382069-0268-3', 'grek2_280'),
    ('39395270-0633-2', 'grek4_270'),
    ('80371193-0761-1', 'grek3_275'),
    ('80371193-0761-3', 'grek3_275'),
    ('80371193-0761-5', 'grek3_275'),
    ('19588042-0529-1', 'grek6_270'),
    ('19588042-0529-3', 'grek6_270'),
    ('0125402890-0242-2', 'grek2_245'),
    ('0125402890-0242-5', 'grek2_245'),
    ('0267153958-0063-1', 'grek4_270'),
    ('0213000436-1037-2', 'grek3_240'),
    ('17978126-0078-1', 'grek4_240'),
    ('62297049-0193-3', 'grek3_290'),
    ('62297049-0193-5', 'grek3_290'),
    ('0121303463-0098-1', 'grek2_245'),
    ('0159049906-0021-1', 'grek2_245'),
    ('0159049906-0021-3', 'grek2_245'),
    ('0243070171-0015-1', 'grek2_260'),
    ('0243070171-0015-3', 'grek2_260'),
    ('40319488-0334-1', 'grek3_260'),
    ('0286907880-0013-1', 'grek4_280'),
    ('29867085-0287-3', 'grek3_285'),
    ('29867085-0287-7', 'grek3_285'),
    ('56736297-0084-2', 'grek3_260'),
    ('56736297-0084-5', 'grek2_260'),
    ('56736297-0084-7', 'grek2_260'),
    ('09103277-0426-4', 'grek2_270'),
    ('09103277-0426-7', 'grek2_270'),
    ('0148294214-0425-1', '2vyal2_240'),
    ('56085233-0313-1', 'grek5_270'),
    ('75009678-0212-1', 'grek3_270'),
    ('75009678-0212-3', 'grek3_270'),
    ('75009678-0212-5', 'grek3_270'),
    ('75009678-0212-7', 'grek3_270'),
    ('75009678-0212-9', 'grek3_270'),
    ('86367462-0279-1', 'grek2_245'),
    ('86367462-0279-3', 'grek2_245'),
    ('32052852-0255-1', 'grek2_260'),
    ('16623100-1251-2', '2vyal5_255'),
    ('19599951-0366-1', 'grek4_280'),
    ('19599951-0366-3', 'grek4_280'),
    ('19599951-0366-5', 'grek4_280'),
    ('19599951-0366-7', 'grek4_280'),
    ('0115729533-0654-1', 'grek2_265'),
    ('0115729533-0654-3', 'grek2_265'),
    ('57395056-0360-2', 'grek2_295'),
    ('38476382-0153-1', 'grek2_245'),
    ('38476382-0153-3', 'grek2_245'),
    ('38476382-0153-5', 'grek2_245'),
    ('38476382-0153-7', 'grek2_245'),
    ('91199565-0137-1', 'grek5_260'),
    ('91199565-0137-3', 'grek5_260'),
    ('89465022-0151-1', 'grek5_250'),
    ('47557337-0063-1', 'grek2_260'),
    ('47557337-0063-3', 'grek2_260'),
    ('89717439-0581-1', 'grek3_290'),
    ('15912666-1883-1', 'len8_270'),
    ('46581572-0888-1', 'grek2_245'),
    ('0141473419-0565-1', 'grek2_245'),
    ('0141473419-0565-3', 'grek2_245'),
    ('30956967-0395-1', 'grek2_245'),
    ('30956967-0395-3', 'grek2_245'),
    ('0124601672-0118-1', 'grek3_270'),
    ('76989254-0159-1', 'grek3_250'),
    ('0111503371-0424-1', 'grek5_275'),
    ('66956385-1248-1', 'vyal3_255'),
    ('18088550-0066-1', 'len3_255'),
    ('40761231-0462-1', 'len5_270'),
    ('0188063759-0097-1', 'grek2_260'),
    ('68530978-0446-1', 'len3_265'),
    ('48843003-0361-1', 'krep4_240'),
    ('37217910-0098-1', 'vyal3_245'),
    ('60141770-0135-1', 'len4_245'),
    ('39415490-0061-1', 'bambuk3_260'),
    ('58709851-1305-1', 'bambuk6_245'),
    ('34419807-0750-1', 'grek7_275'),
    ('0197507387-0266-1', 'mol4_240'),
    ('47890312-0204-1', 'len6_265'),
    ('0139867120-0345-1', 'krep2_240'),
    ('46222568-0194-1', 'len3_245'),
    ('31102359-0209-1', 'len4_245'),
    ('38292992-0093-4', 'bambuk5_270'),
    ('40535972-0200-1', 'vyal3_255'),
    ('39184049-0444-1', 'vyal3_255'),
    ('63043221-0023-4', 'krep2_240'),
    ('41526382-0311-1', 'bambuk3_255'),
    ('98780132-0256-1', 'grek6_250'),
    ('10308268-0314-2', 'grek2_245'),
    ('51118020-0773-1', 'vyal2_265'),
    ('0134572448-0006-2', 'bambuk6_245'),
    ('0172296623-0048-2', 'mol5_245'),
    ('0123276487-0009-1', 'vyal3_245'),
    ('63251369-0244-1', 'mol3_250'),
    ('64280998-0132-2', '2vyal6_240'),
    ('83267352-0146-1', 'krep5_240'),
    ('37279108-0237-2', 'grek6_265'),
    ('0110937240-0112-4', 'grek2_260'),
    ('43833283-1316-1', 'len4_250'),
    ('0230676966-0012-3', 'mol3_240'),
    ('0129246842-0237-2', 'vyal3_245'),
    ('43642303-0253-1', 'vyal3_230'),
    ('49362894-0674-2', 'len4_230'),
    ('51740964-0681-1', 'grek6_265'),
    ('0239784637-0049-1', 'grek3_270'),
    ('73887574-0059-3', 'krep3_235'),
    ('48426023-0486-1', 'len4_275'),
    ('51087103-1350-1', 'bambuk4_245'),
    ('0188254369-0048-4', 'krep6_230'),
    ('74142715-0709-1', 'grek8_295'),
    ('52505149-0290-1', 'bambuk3_265'),
    ('39649051-0772-1', 'grek2_260'),
    ('91622975-0257-1', 'krep6_250'),
    ('06974670-0827-1', 'vyal3_265'),
    ('0133430066-0107-1', '2vyal7_270'),
    ('98173396-0186-1', 'grek4_275'),
    ('32183255-0569-1', 'grek3_270'),
    ('57092791-0197-3', 'vyal2_245'),
    ('49987002-1061-3', 'mol7_260'),
    ('51139221-0152-1', 'vyal6_275'),
    ('42597547-0462-1', 'grek3_290'),
    ('95665775-0273-1', 'len3_240'),
    ('0181845629-0014-1', 'krep3_275'),
    ('0134047123-0316-1', 'vyal2_245'),
    ('0134047123-0317-1', 'vyal2_245'),
    ('82078948-0155-1', 'mol3_240'),
    ('0190923853-0131-1', 'len5_245'),
    ('0149914434-0374-1', 'krep6_250'),
    ('75151144-0155-1', 'grek3_250'),
    ('88681714-0418-10', 'krep5_230'),
    ('18566038-0136-2', 'vyal2_255'),
    ('0152647080-1449-1', 'len4_245'),
    ('42483999-0452-1', 'grek2_245'),
    ('42483999-0452-3', 'grek2_245'),
    ('73599528-0338-5', 'grek4_250'),
    ('33344707-0231-1', 'vyal3_265'),
    ('0109598510-0231-1', 'grek4_275');

-- Материал и размер на карточке — с артикула листа, если в заказе пусто.
UPDATE orders o
SET material = COALESCE(NULLIF(btrim(o.material), ''), mi.material),
    width = COALESCE(o.width, mi.width),
    height = COALESCE(o.height, mi.height),
    marketplace_item_id = COALESCE(o.marketplace_item_id, mi.id)
FROM _ozon146 src
JOIN marketplace_items mi ON mi.sku = src.sku
WHERE (o.order_number = src.posting OR o.ozon_posting_number = src.posting)
  AND COALESCE(o.status, '') <> 'Отменён';

DO $close146$
DECLARE
    v_today_workshop INTEGER;
    v_today_shift INTEGER;
    v_today_actor INTEGER;
    rec RECORD;
    v_ws INTEGER;
    v_shift INTEGER;
    v_actor INTEGER;
    v_already_cut BOOLEAN;
    v_item_id INTEGER;
    v_material_id INTEGER;
    v_qty NUMERIC(12,3);
    v_left NUMERIC(12,3);
    v_take NUMERIC(12,3);
    v_roll RECORD;
    v_updated INTEGER;
    v_has_fabric INTEGER;
    v_shortages TEXT := '';
BEGIN
    SELECT ss.workshop_id, ss.shift_number, ss.user_id
      INTO v_today_workshop, v_today_shift, v_today_actor
      FROM shift_sessions ss
     WHERE ss.workshop_id IS NOT NULL
       AND ss.shift_number IS NOT NULL
       AND (
            ss.closed_at IS NULL
            OR (timezone('Europe/Moscow', ss.opened_at))::date
               = (timezone('Europe/Moscow', now()))::date
       )
     ORDER BY (ss.closed_at IS NULL) DESC,
              CASE WHEN COALESCE(ss.role, '') = 'cutter' THEN 0 ELSE 1 END,
              ss.opened_at DESC
     LIMIT 1;

    IF v_today_workshop IS NULL OR v_today_shift IS NULL THEN
        RAISE EXCEPTION
            'Нет смены на сегодня: не из чего списать ткань по листу сборки 146';
    END IF;

    -- Цех сегодняшней смены только у тех, кого ещё не кроили. Уже раскроенные
    -- остаются на своём цехе — иначе чужая смена «присвоит» чужой расход.
    UPDATE orders o
       SET workshop_id = COALESCE(o.workshop_id, v_today_workshop)
      FROM _ozon146 src
     WHERE (o.order_number = src.posting OR o.ozon_posting_number = src.posting)
       AND COALESCE(o.status, '') <> 'Отменён'
       AND o.cut_at IS NULL
       AND o.cutter_user_id IS NULL
       AND o.sewing_status IN ('Новый', 'На раскрое');

    FOR rec IN
        SELECT o.id, o.order_number, o.material, o.width, o.height,
               o.cut_at, o.cutter_user_id, o.assigned_user_id,
               o.workshop_id, o.sewing_status, src.sku
          FROM orders o
          JOIN _ozon146 src
            ON o.order_number = src.posting
            OR o.ozon_posting_number = src.posting
         WHERE COALESCE(o.status, '') <> 'Отменён'
         ORDER BY o.id
    LOOP
        v_has_fabric := NULL;
        SELECT 1 INTO v_has_fabric
          FROM order_material_usage omu
          JOIN materials m ON m.id = omu.material_id
          JOIN material_types mt ON mt.id = m.type_id
         WHERE omu.order_id = rec.id
           AND mt.name = 'Тюль'
         LIMIT 1;
        -- Ткань уже снята (обычно той сменой, что кроила) — второй раз не списываем.
        IF v_has_fabric IS NOT NULL THEN
            CONTINUE;
        END IF;

        v_already_cut := rec.cut_at IS NOT NULL
            OR rec.cutter_user_id IS NOT NULL
            OR rec.sewing_status IN
               ('Раскроено', 'В работе', 'Стикеровка', 'Готовые', 'Со склада');

        v_ws := NULL;
        v_shift := NULL;
        v_actor := NULL;

        IF v_already_cut THEN
            -- Смена закройщика в момент раскроя — не сегодняшняя, если кроила другая.
            SELECT ss.workshop_id, ss.shift_number, ss.user_id
              INTO v_ws, v_shift, v_actor
              FROM shift_sessions ss
             WHERE ss.user_id = COALESCE(rec.cutter_user_id, rec.assigned_user_id)
               AND ss.workshop_id IS NOT NULL
               AND ss.shift_number IS NOT NULL
               AND ss.opened_at <= COALESCE(rec.cut_at, now())
               AND (ss.closed_at IS NULL OR ss.closed_at >= COALESCE(rec.cut_at, ss.opened_at))
             ORDER BY CASE WHEN COALESCE(ss.role, '') = 'cutter' THEN 0 ELSE 1 END,
                      ss.opened_at DESC
             LIMIT 1;

            IF v_ws IS NULL THEN
                SELECT w.id, u.shift_number, u.id
                  INTO v_ws, v_shift, v_actor
                  FROM users u
                  JOIN workshops w ON w.name = CASE
                      WHEN u.workshop IN ('Цех №2', 'Тестовый цех (QA)') THEN 'Цех №1'
                      ELSE u.workshop
                  END
                 WHERE u.id = COALESCE(rec.cutter_user_id, rec.assigned_user_id)
                 LIMIT 1;
            END IF;

            IF v_ws IS NULL THEN
                v_ws := rec.workshop_id;
            END IF;
        ELSE
            v_ws := COALESCE(rec.workshop_id, v_today_workshop);
            v_shift := v_today_shift;
            v_actor := v_today_actor;
        END IF;

        IF v_ws IS NULL OR v_shift IS NULL THEN
            v_shortages := v_shortages || rec.order_number
                || ': не понятно, с какой смены списывать ткань; ';
            CONTINUE;
        END IF;

        v_item_id := NULL;
        SELECT mi.id INTO v_item_id
          FROM marketplace_items mi
         WHERE mi.sku = rec.sku
         LIMIT 1;
        IF v_item_id IS NULL AND rec.material IS NOT NULL
           AND rec.width IS NOT NULL AND rec.height IS NOT NULL THEN
            SELECT mi.id INTO v_item_id
              FROM marketplace_items mi
             WHERE mi.material = rec.material
               AND mi.width = rec.width
               AND mi.height = rec.height
             LIMIT 1;
        END IF;

        v_material_id := NULL;
        v_qty := NULL;
        IF v_item_id IS NOT NULL THEN
            SELECT mim.material_id, mim.quantity
              INTO v_material_id, v_qty
              FROM marketplace_item_materials mim
              JOIN materials m ON m.id = mim.material_id
              JOIN material_types mt ON mt.id = m.type_id
             WHERE mim.marketplace_item_id = v_item_id
               AND mt.name = 'Тюль'
               AND (mim.workshop_id IS NULL OR mim.workshop_id = v_ws)
             ORDER BY (mim.workshop_id = v_ws) DESC NULLS LAST, mim.id
             LIMIT 1;
        END IF;

        IF v_material_id IS NULL AND rec.material IS NOT NULL THEN
            SELECT m.id INTO v_material_id
              FROM materials m
              JOIN material_types mt ON mt.id = m.type_id
             WHERE mt.name = 'Тюль'
               AND (m.name = rec.material
                    OR (rec.material = 'Вуаль (без ут)' AND m.name = 'Вуаль без утяжелителя')
                    OR (rec.material = 'Вуаль без утяжелителя' AND m.name = 'Вуаль (без ут)'))
             LIMIT 1;
            IF rec.width IS NOT NULL THEN
                v_qty := round(rec.width::numeric / 100, 3);
            END IF;
        END IF;

        IF v_material_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
            v_shortages := v_shortages || rec.order_number
                || ': нет нормы ткани (' || COALESCE(rec.sku, '?') || '); ';
            CONTINUE;
        END IF;

        v_left := v_qty;
        FOR v_roll IN
            SELECT r.id, r.remaining_quantity
              FROM rolls r
             WHERE r.material_id = v_material_id
               AND r.status = 'in_workshop'
               AND r.accepted_at IS NOT NULL
               AND r.defect_flagged_at IS NULL
               AND r.workshop_id = v_ws
               AND r.shift_number = v_shift
               AND r.remaining_quantity > 0
             ORDER BY r.created_at ASC, r.id
             FOR UPDATE
        LOOP
            EXIT WHEN v_left <= 0;
            v_take := LEAST(v_roll.remaining_quantity, v_left);
            v_updated := NULL;
            UPDATE rolls
               SET remaining_quantity = round(remaining_quantity - v_take, 3),
                   status = CASE
                       WHEN remaining_quantity - v_take <= 0 THEN 'completed'
                       ELSE status
                   END,
                   completed_at = CASE
                       WHEN remaining_quantity - v_take <= 0 THEN now()
                       ELSE completed_at
                   END
             WHERE id = v_roll.id
               AND remaining_quantity >= v_take - 0.001
             RETURNING 1 INTO v_updated;
            IF v_updated IS NULL THEN
                CONTINUE;
            END IF;
            INSERT INTO order_material_usage (
                order_id, material_id, roll_id, quantity,
                actor_user_id, actor_workshop_id, actor_shift_number, is_foreign_shift
            ) VALUES (
                rec.id, v_material_id, v_roll.id, v_take,
                v_actor, v_ws, v_shift, false
            );
            v_left := v_left - v_take;
        END LOOP;

        IF v_left > 0.001 THEN
            v_shortages := v_shortages || rec.order_number || ': не хватает '
                || trim(to_char(v_left, 'FM9990.999')) || ' п.м. '
                || COALESCE((SELECT name FROM materials WHERE id = v_material_id), '?')
                || ' на смене ' || v_shift::text
                || CASE WHEN v_already_cut THEN ' (раскрой другой смены)' ELSE '' END
                || '; ';
        END IF;
    END LOOP;

    IF v_shortages <> '' THEN
        RAISE EXCEPTION
            'Не хватает ткани (сегодня смена % цеха %): %',
            v_today_shift, v_today_workshop, v_shortages;
    END IF;
END
$close146$;

UPDATE orders o
SET sewing_status = 'Готовые',
    packed_at = COALESCE(o.packed_at, now())
FROM _ozon146 src
WHERE (o.order_number = src.posting OR o.ozon_posting_number = src.posting)
  AND o.sewing_status NOT IN ('Готовые', 'Со склада')
  AND COALESCE(o.status, '') <> 'Отменён';

DROP TABLE _ozon146;
