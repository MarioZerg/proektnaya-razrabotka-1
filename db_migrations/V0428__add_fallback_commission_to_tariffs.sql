-- Ozon отдаёт комиссию по каждому товару, а Wildberries и Яндекс — нет:
-- у них она привязана к категории, которой в нашем справочнике товаров не
-- заведено. Без комиссии расчёт прибыли невозможен, поэтому даём менеджеру
-- задать её одним числом на площадку — он видит её в своём кабинете.
-- Комиссия по товару, если площадка её прислала, всегда в приоритете.
ALTER TABLE marketplace_tariffs
  ADD COLUMN IF NOT EXISTS commission_fbo_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_fbs_percent NUMERIC(6,2) NOT NULL DEFAULT 0;