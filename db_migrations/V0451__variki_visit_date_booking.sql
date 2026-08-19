-- Подарки с записью на конкретную дату (аквапарк, массаж, баня).
--
-- Такие услуги нельзя выдать готовым файлом заранее: место нужно бронировать под
-- конкретный день. Поэтому сотрудник при покупке выбирает дату посещения, заявка
-- уходит админу, тот бронирует и прикладывает сертификат уже на эту дату.
ALTER TABLE variki_shop_items
  ADD COLUMN IF NOT EXISTS needs_visit_date BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN variki_shop_items.needs_visit_date IS
 'Требуется выбрать дату посещения при покупке — сертификат бронирует админ.';

-- Желаемая дата посещения, выбранная сотрудником при покупке.
ALTER TABLE variki_purchases ADD COLUMN IF NOT EXISTS visit_date DATE NULL;
COMMENT ON COLUMN variki_purchases.visit_date IS
 'На какую дату сотрудник хочет посетить место. NULL — дата не требуется.';
