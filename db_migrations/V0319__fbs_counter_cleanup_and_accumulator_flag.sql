-- 1. Возвращаем в производство 9 «готовых» FBS-заказов WB.
--
-- Сверка с WB показала: все девять на стороне маркетплейса имеют статус new/waiting —
-- то есть сборочные задания живые и ждут отгрузки. У нас они были помечены «Готовые»,
-- хотя ни швея, ни упаковщица по ним не отмечены: заказы попали в этот статус мимо
-- конвейера. Из-за них счётчик готовых показывал 9 штук, которых физически нет.
--
-- Не удаляем и не закрываем: заказы реальные, их нужно сшить. Возвращаем в очередь
-- производства, чтобы они попали к закройщику как обычные новые.
UPDATE orders
SET sewing_status = 'Новый'
WHERE marketplace = 'WB'
  AND order_type = 'FBS'
  AND sewing_status = 'Готовые'
  AND sewer_user_id IS NULL
  AND packer_user_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM wb_supply_orders w WHERE w.order_id = orders.id);

-- 2. Отделяем накопительную поставку от сборки кладовщика.
--
-- Накопительная — служебный буфер: туда падают вещи, когда упаковщица печатает стикер.
-- Сборка — то, что кладовщик собирает руками, сканируя стикеры. Их нужно различать:
-- по счётчику накопительной кладовщик решает, идти ли за контейнером, а активная
-- сборка у кладовщика может быть только одна.
ALTER TABLE t_p86119184_proektnaya_razrabotk.marketplace_supplies
    ADD COLUMN IF NOT EXISTS is_accumulator BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.marketplace_supplies.is_accumulator IS
    'Служебная накопительная поставка: сюда попадают вещи при стикеровке упаковщицей';

-- Помечаем уже созданные накопительные поставки (их заводила система, а не человек).
UPDATE t_p86119184_proektnaya_razrabotk.marketplace_supplies
SET is_accumulator = true
WHERE marketplace = 'WB' AND type = 'FBS'
  AND created_by IS NULL
  AND COALESCE(comment, '') LIKE 'Накопительная поставка%';
