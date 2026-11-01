-- Габариты и вес упаковки товара: по ним сайт считает доставку Ozon Доставкой.
-- Без них у всех ширин одной карточки была одна и та же цена доставки.
-- pack_source: 'ozon' — подтянуто из карточки OZON, 'manual' — вписано вручную
-- (ручные значения синхронизация не перезаписывает).
ALTER TABLE t_p86119184_proektnaya_razrabotk.marketplace_items
  ADD COLUMN IF NOT EXISTS pack_length_mm INTEGER,
  ADD COLUMN IF NOT EXISTS pack_width_mm INTEGER,
  ADD COLUMN IF NOT EXISTS pack_height_mm INTEGER,
  ADD COLUMN IF NOT EXISTS pack_weight_g INTEGER,
  ADD COLUMN IF NOT EXISTS pack_source VARCHAR(16),
  ADD COLUMN IF NOT EXISTS pack_updated_at TIMESTAMP NULL;
