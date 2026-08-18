-- Ozon отдаёт по каждому товару не только комиссию, но и логистику с эквайрингом
-- в рублях — эти цифры точнее общих тарифов, потому что зависят от габаритов
-- конкретной вещи. Храним их рядом с ценой.
ALTER TABLE marketplace_prices
  -- Доставка до покупателя + магистраль, ₽ за единицу.
  ADD COLUMN IF NOT EXISTS logistics_fbo NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS logistics_fbs NUMERIC(12,2),
  -- Обратная логистика: платим за каждый возврат/отказ.
  ADD COLUMN IF NOT EXISTS return_fbo NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS return_fbs NUMERIC(12,2),
  -- Эквайринг в рублях (Ozon считает его сам, а не процентом).
  ADD COLUMN IF NOT EXISTS acquiring_amount NUMERIC(12,2);