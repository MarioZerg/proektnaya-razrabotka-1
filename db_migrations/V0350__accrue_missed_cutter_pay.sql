-- Доначисление закройщику Коротаевой Н.А. за 12 раскроев от 10.08.
--
-- Почему не начислилось: раскрой этих заказов пришёлся на момент, когда в тарифах
-- по тканям «Молния» и «Мрамор» автоматически создались строки с нулевой ставкой
-- по каждой ширине (10.08, 06:24). Оплата закройщика берётся по ставке НА ТКАНЬ
-- (width IS NULL) — она заполнена и равна 10 ₽/пог.м., но в тот момент расчёт
-- молча дал ноль, и начисление не создалось. Ошибки никто не увидел: человек
-- просто остался без денег за смену.
--
-- Считаем ровно по штатной формуле: чистая ширина товара в пог.м. × ставка на ткань
-- в цехе заказа. Никаких округлений «на глаз».
--
-- ON CONFLICT защищает от повторного начисления: если строка за заказ уже есть,
-- вторая не появится. Заплатить дважды за одну работу — так же плохо, как не
-- заплатить вовсе.

INSERT INTO salary_accruals (user_id, type, amount, order_id, description, accrued_for)
SELECT
    o.cutter_user_id,
    'cutter_cut',
    round(o.width / 100.0 * r.rate, 2),
    o.id,
    'Раскрой заказа #' || o.id || ' (' || m.name || ' ' || o.width::int
        || ' см) - ' || round(o.width / 100.0, 2) || ' пог.м.',
    o.cut_at::date
FROM orders o
JOIN materials m ON m.name = o.material
JOIN salary_rates r
      ON r.role = 'cutter'
     AND r.material_id = m.id
     AND r.width IS NULL
     AND r.workshop_id = o.workshop_id
WHERE o.cut_at IS NOT NULL
  AND o.cutter_user_id IS NOT NULL
  AND COALESCE(o.source, '') <> 'import'
  AND r.rate > 0
  AND NOT EXISTS (
      SELECT 1 FROM salary_accruals a
      WHERE a.order_id = o.id AND a.type = 'cutter_cut'
  )
ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING;
