-- ЭТАП ОВЕРЛОКА В ЦЕХЕ.
--
-- Часть тканей нельзя шить сразу: край осыпается, и его сначала обмётывают на
-- оверлоке, а уже потом отдают швее на прямострочку. Раньше цех держал это в
-- голове, и система про такой этап не знала — заказ из очереди «Раскроено» мог
-- уйти швее непрошедшим оверлок.
--
-- Вводим четыре вещи: признак ткани, допуск сотрудника, отметку прохождения на
-- заказе и тарифы для новой оплаты.

-- 1. ТКАНЬ ТРЕБУЕТ ОВЕРЛОКА. Отмечает админ в справочнике материалов. По этому
--    признаку заказ помечается на раскрое — закройщик видит метку на листе.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS requires_overlock boolean NOT NULL DEFAULT false;

-- 2. ДОПУСК СОТРУДНИКА К ОВЕРЛОКУ. Отдельной должности не заводим: швея работает
--    и на оверлоке, и на прямострочке, переключать роль в середине смены неудобно.
--    Галочку ставит админ в карточке сотрудника; только такие швеи видят вкладку.
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_overlock boolean NOT NULL DEFAULT false;

-- 3. ОТМЕТКИ НА ЗАКАЗЕ.
--    requires_overlock — заказ проставляется на раскрое по признаку ткани. Копируем
--      в заказ, а не смотрим на ткань каждый раз: признак ткани могут поменять
--      завтра, а уже раскроенные вещи должны пройти маршрут, по которому их запустили.
--    overlocked_at / overlock_user_id — кто и когда обметал. По ним считается
--      оплата оверлочницы и определяется, что вещь этап прошла.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS requires_overlock boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS overlocked_at timestamp NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS overlock_user_id integer NULL REFERENCES users(id);

-- Очередь оверлока и разбор «обработанных» из «Раскроено» — самые частые выборки
-- на конвейере, поэтому индексируем.
CREATE INDEX IF NOT EXISTS idx_orders_overlock
    ON orders (sewing_status, requires_overlock, overlocked_at);

-- 4. ТАРИФЫ. Три новые строки на каждый цех, значения из договорённости:
--    overlock          — оверлочнице 5 ₽ за пог.м. ширины;
--    sewer_overlock    — швее за прямострочку по оверлоченной вещи 5 ₽ за пог.м.
--                        вместо её обычной ставки за штуку: работы там меньше;
--    packer_overlock   — упаковщице 3 ₽ за пог.м.: гладить такую вещь не нужно.
--    Ставки настраиваются в финансах как все остальные — здесь только первое
--    заполнение.
INSERT INTO salary_rates (role, material_id, width, rate, workshop_id)
SELECT r.role, NULL, NULL, r.rate, w.id
FROM workshops w
CROSS JOIN (VALUES ('overlock', 5.00), ('sewer_overlock', 5.00), ('packer_overlock', 3.00)) AS r(role, rate)
WHERE NOT EXISTS (
    SELECT 1 FROM salary_rates sr
    WHERE sr.role = r.role AND sr.workshop_id = w.id
      AND sr.material_id IS NULL AND sr.width IS NULL
);
