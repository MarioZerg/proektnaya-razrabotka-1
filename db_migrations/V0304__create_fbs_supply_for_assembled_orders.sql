-- Собираем поставку FBS из заказов, уже собранных на стороне OZON.
--
-- Это отправления в статусе awaiting_deliver: их не нужно шить, но нужно отгрузить.
-- Складываем их в одну поставку, чтобы кладовщик видел объём отгрузки и не искал
-- эти заказы поштучно.
INSERT INTO marketplace_supplies (marketplace, type, status, comment, created_at)
VALUES ('OZON', 'FBS', 'Открытая',
        'Заказы, собранные на стороне OZON — перенесены из старой системы', now());

-- Привязываем к созданной поставке все готовые FBS-заказы OZON, которые ещё
-- никуда не привязаны.
UPDATE orders
SET supply_id = (
      SELECT id FROM marketplace_supplies
      WHERE marketplace = 'OZON' AND type = 'FBS'
        AND comment LIKE 'Заказы, собранные на стороне OZON%'
      ORDER BY id DESC LIMIT 1
    )
WHERE marketplace = 'OZON'
  AND order_type = 'FBS'
  AND sewing_status = 'Готовые'
  AND supply_id IS NULL;
