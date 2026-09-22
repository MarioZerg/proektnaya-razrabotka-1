-- ПОСТАВКА FBO #1307 (заявка OZON 2000065880431): убираем хвост, который не уехал.
--
-- ЧТО БЫЛО. По заявке обещали 249 единиц. Кладовщик физически разложил по
-- коробам 246 вещей и на этом сборка закончилась — короба заклеены, грузоместа
-- на OZON заведены. Но на конвейере остались висеть 33 заказа-штуки, которые
-- ни в один короб так и не попали.
--
-- Это тупик с обеих сторон:
--   * поставка числится недособранной (246 из 249) и система не даёт её
--     отгрузить — стоит защита от недовоза;
--   * 33 заказа висят в плане производства, и цех продолжал бы их шить, хотя
--     везти их уже некуда — заявка уехала.
--
-- ПОЧЕМУ ЭТИ 33 БЕЗОПАСНО УБРАТЬ. Все они в статусе «Со склада»: под них не
-- раскраивали ткань и никому не начисляли зарплату. Проверено поимённо —
-- ни одной записи в order_material_usage и salary_accruals. То есть убираем
-- только план, а не чью-то выполненную работу.
--
-- ПОЧЕМУ ОТМЕНА, А НЕ УДАЛЕНИЕ. Заказы помечаем отменёнными, а не стираем:
--   * очередь раскроя и пошива отменённые не выдаёт (условие cancelled_sql) —
--     цех их больше не увидит, а это и была главная цель;
--   * в поставке они останутся видимыми как отменённые, и через месяц будет
--     понятно, почему привезли 246 вместо 249. Стёртые записи такой вопрос
--     оставили бы без ответа.

-- 1. Возвращаем вещи в свободный остаток.
--
-- Отгруженные (shipped) НЕ трогаем: такая вещь физически уехала, и возврат её
-- в остаток создал бы на складе товар, которого нет. Здесь это GW-722630
-- по заказу 2000065880431-218 — она отгружена ещё раньше.
UPDATE goods_warehouse
SET status = 'in_stock',
    reserved_order_id = NULL,
    matched_at = NULL,
    -- Ярлык отправления снимаем: он выписан под заказ, которого больше нет.
    -- Иначе сканер подбора сказал бы «стикер наклеен, неси в короб», а на
    -- пакете висела бы наклейка отменённого заказа.
    shipping_labeled_at = NULL,
    shipping_labeled_by = NULL,
    shipping_labeled_by_name = NULL
WHERE shipped_at IS NULL
  AND reserved_order_id IN (
    SELECT o.id FROM orders o
    WHERE o.supply_id = 1307
      AND o.sewing_status = 'Со склада'
      AND NOT EXISTS (
        SELECT 1 FROM marketplace_supply_items msi
        WHERE msi.supply_id = 1307
          AND (msi.goods_warehouse_id = o.fulfilled_from_stock_id
               OR msi.goods_warehouse_id IN (
                 SELECT g.id FROM goods_warehouse g
                 WHERE g.order_id = o.id OR g.reserved_order_id = o.id)))
  );

-- 2. Снимаем заказы с конвейера.
--
-- Связь с вещью рвём (fulfilled_from_stock_id = NULL) — иначе заказ продолжал
-- бы держать вещь, которую мы только что вернули в остаток.
UPDATE orders o
SET status = 'Отменён',
    cancelled_at = now(),
    fulfilled_from_stock_id = NULL,
    assigned_user_id = NULL
WHERE o.supply_id = 1307
  AND o.sewing_status = 'Со склада'
  AND COALESCE(o.status, '') <> 'Отменён'
  AND NOT EXISTS (
    SELECT 1 FROM marketplace_supply_items msi
    WHERE msi.supply_id = 1307
      AND (msi.goods_warehouse_id = o.fulfilled_from_stock_id
           OR msi.goods_warehouse_id IN (
             SELECT g.id FROM goods_warehouse g
             WHERE g.order_id = o.id OR g.reserved_order_id = o.id)))
  -- Подстраховка: ни ткани, ни начислений по заказу быть не должно.
  AND NOT EXISTS (SELECT 1 FROM order_material_usage u WHERE u.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM salary_accruals sa WHERE sa.order_id = o.id);

-- 3. План приводим к факту: сколько реально уложено в короба.
UPDATE marketplace_supplies
SET total_quantity_marketplace = (
      SELECT COUNT(*) FROM marketplace_supply_items WHERE supply_id = 1307)
WHERE id = 1307;
