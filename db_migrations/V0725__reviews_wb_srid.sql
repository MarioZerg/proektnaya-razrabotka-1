-- Отзыв WB приходит с буквенным srid (= rid сборочного задания, вида eAD.iba…).
-- Раньше srid только искали в момент синка и сразу выбрасывали: в reviews его
-- не было. После синка старые отзывы без order_id уже нельзя было привязать
-- к швее, пока снова не придёт та же страница с WB. Храним srid в отзыве —
-- ищем заказ по orders.wb_rid и показываем код в таблице.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS wb_srid VARCHAR(120) NULL;
CREATE INDEX IF NOT EXISTS ix_reviews_wb_srid ON reviews (wb_srid)
  WHERE wb_srid IS NOT NULL;
