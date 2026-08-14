-- Пересчёт себестоимости активных рулонов по прайсу поставщиков.
--
-- Зачем: рулоны заводились до того, как в системе появились цены поставщиков,
-- поэтому себестоимость у них проставлена «на глаз» и разъехалась с прайсом.
-- Из-за этого стоимость склада и штрафы за недостачу считались от неверных цифр.
--
-- Решение владельца: у материалов, которые есть у двух поставщиков, берём САМУЮ
-- ВЫСОКУЮ цену — оценка склада получается осторожной, без завышения прибыли.
-- Курсы валют оставляем те, что указаны в карточках поставщиков.
--
-- Трогаем ТОЛЬКО рулоны в работе (склад и цеха). Завершённые рулоны — это история
-- закупок и уже посчитанная себестоимость проданного товара, её не переписываем.
-- Материалы, которых нет в прайсе ни у кого, остаются со своей прежней ценой.
--
-- Логистику сохраняем: итоговая себестоимость = цена в рублях + логистика на единицу.

UPDATE rolls r
SET
  purchase_price    = p.price,
  purchase_currency = p.currency,
  purchase_rate     = p.rate,
  cost_per_unit     = ROUND(p.price * p.rate + COALESCE(r.logistics_per_unit, 0), 4)
FROM (
  -- По каждому материалу — строка прайса с самой высокой ценой в пересчёте на рубли.
  SELECT DISTINCT ON (sp.material_id)
    sp.material_id,
    sp.price,
    upper(sp.currency) AS currency,
    CASE WHEN upper(sp.currency) = 'RUB' THEN 1 ELSE COALESCE(s.exchange_rate, 1) END AS rate
  FROM supplier_prices sp
  JOIN suppliers s ON s.id = sp.supplier_id
  ORDER BY
    sp.material_id,
    sp.price * CASE WHEN upper(sp.currency) = 'RUB' THEN 1 ELSE COALESCE(s.exchange_rate, 1) END DESC
) p
WHERE r.material_id = p.material_id
  AND r.status <> 'completed';
