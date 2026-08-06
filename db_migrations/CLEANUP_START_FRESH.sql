-- ============================================================================
-- ОЧИСТКА СИСТЕМЫ ДЛЯ СТАРТА С ЧИСТОГО ЛИСТА
-- ============================================================================
--
-- Удаляет всю рабочую историю: заказы, ткань, склад, отгрузки, зарплату, кассу.
--
-- ЧТО ОСТАЁТСЯ (настройки, без них система не работает):
--   users, user_roles              — сотрудники и их должности
--   workshops, workshop_settings   — цеха и все их настройки
--   shifts, shift_calendar         — смены и график
--   salary_rates                   — тарифы зарплаты
--   materials, material_types      — справочник материалов
--   suppliers                      — поставщики
--   shelves, hangers               — полки и вешалки
--   marketplace_integrations       — ключи доступа к маркетплейсам
--   marketplace_items              — КАРТОЧКИ ТОВАРОВ для интеграции (675 шт.):
--                                    артикулы OZON/WB, штрихкоды, размеры, ткань.
--                                    По ним заказы с маркетплейсов распознаются
--                                    и попадают на конвейер — удалять НЕЛЬЗЯ
--   marketplace_item_materials     — сколько метров ткани нужно на каждый товар
--   system_settings                — общие настройки
--
-- ВАЖНО: порядок удаления не менять — таблицы связаны между собой, и при другом
-- порядке база откажется удалять строки (нарушение связей).
--
-- Всё выполняется одной транзакцией: если что-то пойдёт не так, откатится целиком
-- и данные останутся на месте.
-- ============================================================================

BEGIN;

-- --- 1. Отзывы, поставки на маркетплейс -----------------------------------
--     Возвраты и склад товара связаны друг с другом в обе стороны, поэтому
--     сначала разрываем связь, а удаляем их ниже (пункты 2 и 4).
DELETE FROM reviews;
DELETE FROM marketplace_supply_items;
DELETE FROM marketplace_supply_boxes;
DELETE FROM wb_supply_orders;
DELETE FROM marketplace_supplies;

-- --- 2. Возвраты с маркетплейсов ------------------------------------------
UPDATE goods_warehouse SET repack_return_id = NULL WHERE repack_return_id IS NOT NULL;
DELETE FROM marketplace_returns;

-- --- 3. Зарплата и касса --------------------------------------------------
--     Начисления и касса ссылаются на выплаты, поэтому выплаты удаляем последними.
DELETE FROM salary_accruals;
DELETE FROM cash_box_transactions;
DELETE FROM salary_payouts;

-- --- 4. Склад готового товара --------------------------------------------
DELETE FROM goods_warehouse;

-- --- 5. Заказы и расход материала по ним ----------------------------------
DELETE FROM order_material_usage;
DELETE FROM auto_order_blocks;
DELETE FROM orders;

-- --- 6. Отгрузки, брак, движения материала --------------------------------
DELETE FROM shipment_items;
DELETE FROM material_defects;
DELETE FROM shipments;
DELETE FROM material_movements;

-- --- 7. Рулоны ткани ------------------------------------------------------
DELETE FROM rolls;

-- --- 8. Инвентаризация ----------------------------------------------------
DELETE FROM inventory_items;

-- --- 9. Смены сотрудников и журнал действий -------------------------------
DELETE FROM shift_sessions;
DELETE FROM audit_log;

-- --- 10. Нумерация с единицы ----------------------------------------------
--     Чтобы новые заказы и рулоны начинались с 1, а не продолжали старые номера.
ALTER SEQUENCE orders_id_seq RESTART WITH 1;
ALTER SEQUENCE rolls_id_seq RESTART WITH 1;
ALTER SEQUENCE goods_warehouse_id_seq RESTART WITH 1;
ALTER SEQUENCE shipments_id_seq RESTART WITH 1;
ALTER SEQUENCE shift_sessions_id_seq RESTART WITH 1;
ALTER SEQUENCE audit_log_id_seq RESTART WITH 1;

COMMIT;

-- ============================================================================
-- ПРОВЕРКА ПОСЛЕ ОЧИСТКИ — должно быть 0 везде в первом блоке
-- и НЕ ноль во втором (настройки на месте):
--
-- SELECT 'заказы' AS chto, count(*) FROM orders
-- UNION ALL SELECT 'рулоны', count(*) FROM rolls
-- UNION ALL SELECT 'склад товара', count(*) FROM goods_warehouse
-- UNION ALL SELECT 'зарплата', count(*) FROM salary_accruals
-- UNION ALL SELECT '--- ОСТАЛОСЬ ---', NULL
-- UNION ALL SELECT 'сотрудники', count(*) FROM users
-- UNION ALL SELECT 'цеха', count(*) FROM workshops
-- UNION ALL SELECT 'материалы', count(*) FROM materials
-- UNION ALL SELECT 'тарифы зарплаты', count(*) FROM salary_rates
-- UNION ALL SELECT 'поставщики', count(*) FROM suppliers
-- UNION ALL SELECT 'карточки товаров', count(*) FROM marketplace_items;
-- ============================================================================